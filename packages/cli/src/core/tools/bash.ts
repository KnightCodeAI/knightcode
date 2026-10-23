import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import type { AgentTool } from "@knightcode/agent";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	type ShellConfig,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import { type BackgroundShellManager, markBoundTool, markUnboundTool } from "../background-shells.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { BASH_UPDATE_THROTTLE_MS, createShellRenderers } from "./renderers/bash.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
/** Output limit of `structuredContent.output`, which programmatic callers such as codemode scripts receive. */
const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}

	const timeoutMs = timeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
	}
	return timeoutMs;
}

const commandParameter = Type.String({ description: "Shell command to execute" });
const timeoutParameter = Type.Optional(
	Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
);

const foregroundBashSchema = Type.Object({ command: commandParameter, timeout: timeoutParameter });

/** The schema with background support, declared when the tool has a background shell manager. */
const bashSchema = Type.Object({
	command: commandParameter,
	timeout: timeoutParameter,
	run_in_background: Type.Optional(
		Type.Boolean({ description: "Run in the background: return at once with a task ID and output file" }),
	),
});

const BACKGROUND_DESCRIPTION =
	" Set run_in_background for commands that run long or never exit (dev servers, watchers, long builds and test runs): the call returns at once with a task ID and an output file, the command keeps running across turns, and you are notified when it exits. Do not poll or sleep waiting for it; read the output file only when you need its output sooner. Stop it with task_stop. No `&` needed. A timeout still stops the command in the background.";

const BACKGROUND_STARTED_HINT =
	"You will be notified when it exits. Do not poll the file or sleep while waiting; read it only if you need its output before then.";

export const bashToolSystemPromptContribution = {
	snippet: "Execute bash commands (ls, grep, find, etc.)",
	guidelines: ["You can inspect KNIGHTCODE_* environment variables for current model and session details."],
} as const;

export type BashToolInput = Static<typeof bashSchema>;

/**
 * Result for programmatic callers such as codemode scripts. A non-zero exit code is an error result for the model, but scripts still resolve to this value.
 * `output` is not limited like the model-facing output: callers decide how much of it reaches the model.
 */
const bashOutputSchema = Type.Object({
	output: Type.String({ description: "Combined stdout and stderr, possibly truncated" }),
	truncated: Type.Boolean(),
	full_output_path: Type.Optional(
		Type.String({ description: "Full output, when truncated or when the command runs in the background" }),
	),
	exit_code: Type.Optional(Type.Number({ description: "Absent when the command runs in the background" })),
	background_task_id: Type.Optional(
		Type.String({ description: "Set when the command runs in the background; pass it to task_stop" }),
	),
	wall_time_seconds: Type.Number(),
});

export type BashToolOutput = Static<typeof bashOutputSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	/** Set on a result whose command keeps running in the background. */
	background?: {
		taskId: string;
		/** Whether the user moved a running foreground command there, rather than the model starting it there. */
		movedByUser: boolean;
	};
	/** Set on progress updates while the user can move the command to the background. */
	backgroundable?: boolean;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to the exit code. Report signal terminations as 128 + signal number;
	 * a null exit code is treated as a failed command.
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/** Shared process execution used by the built-in shell tools. */
export function createLocalShellOperations(shellName: string, resolveShellConfig: () => ShellConfig): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			const timeoutMs = resolveTimeoutMs(timeout);
			if (signal?.aborted) {
				throw new Error("aborted");
			}
			const shellConfig = resolveShellConfig();
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute ${shellName} commands.`);
			}

			const commandFromStdin = shellConfig.commandTransport === "stdin";
			const child = spawn(shellConfig.shell, commandFromStdin ? shellConfig.args : [...shellConfig.args, command], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? getShellEnv(),
				stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			if (commandFromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(command);
			}
			if (child.pid) trackDetachedChildPid(child.pid);
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				// Set timeout if provided.
				if (timeoutMs !== undefined) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeoutMs);
				}
				// Stream stdout and stderr.
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				// Handle abort signal by killing the entire process tree.
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				// Handle shell spawn errors and wait for the process to terminate without hanging
				// on inherited stdio handles held by detached descendants.
				const exitCode = await waitForChildProcess(child);
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeout}`);
				}
				// A signal-killed shell has no exit code. Use the standard shell convention so
				// callers do not mistake the termination for a successful command.
				const signalCode = child.signalCode;
				return { exitCode: exitCode ?? (signalCode ? 128 + (osConstants.signals[signalCode] ?? 0) : 1) };
			} finally {
				if (child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

/**
 * Create bash operations using KnightCode's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want KnightCode's
 * standard local shell behavior while wrapping or rewriting commands.
 */
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
	return createLocalShellOperations("bash", () => getShellConfig(options?.shellPath));
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(
	command: string,
	cwd: string,
	spawnHook: BashSpawnHook | undefined,
	exposeSessionEnvironment: boolean,
	ctx: ExtensionContext | undefined,
): BashSpawnContext {
	const env = { ...getShellEnv() };
	delete env.KNIGHTCODE_SESSION_ID;
	delete env.KNIGHTCODE_SESSION_FILE;
	delete env.KNIGHTCODE_PROVIDER;
	delete env.KNIGHTCODE_MODEL;
	delete env.KNIGHTCODE_REASONING_LEVEL;
	if (exposeSessionEnvironment && ctx) {
		const model = ctx.model;
		env.KNIGHTCODE_SESSION_ID = ctx.sessionManager.getSessionId();
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (sessionFile) env.KNIGHTCODE_SESSION_FILE = sessionFile;
		if (model) {
			env.KNIGHTCODE_PROVIDER = model.provider;
			env.KNIGHTCODE_MODEL = model.id;
		}
		if (ctx.thinkingLevel) env.KNIGHTCODE_REASONING_LEVEL = ctx.thinkingLevel;
	}
	const baseContext: BashSpawnContext = { command, cwd, env };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Expose current KnightCode session metadata as KNIGHTCODE_* environment variables. Default: true */
	exposeSessionEnvironment?: boolean;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/**
	 * Owner of commands that keep running after the call returns. With it the tool accepts
	 * `run_in_background`, and a running foreground command can be moved to the background.
	 */
	backgroundShells?: BackgroundShellManager;
}

export type BashRenderState = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	interval: NodeJS.Timeout | undefined;
};

export interface ShellToolConfig {
	name: string;
	label: string;
	/** Capitalised name shown in the transcript, e.g. `Bash(npm test)`. */
	displayName: string;
	shellName: string;
	prompt: string;
	promptSnippet: string;
	promptGuidelines?: readonly string[];
	tempFilePrefix: string;
}

export function createShellToolDefinition(
	cwd: string,
	config: ShellToolConfig,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
	const commandPrefix = options?.commandPrefix;
	const exposeSessionEnvironment = options?.exposeSessionEnvironment ?? true;
	const spawnHook = options?.spawnHook;
	const backgroundShells = options?.backgroundShells;
	const definition: ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> = {
		name: config.name,
		label: config.label,
		description: `Execute a ${config.shellName} command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.${backgroundShells ? BACKGROUND_DESCRIPTION : ""}`,
		promptSnippet: config.promptSnippet,
		promptGuidelines: exposeSessionEnvironment && config.promptGuidelines ? [...config.promptGuidelines] : undefined,
		// Without a manager nothing could own a background command, so the parameter is not offered.
		parameters: backgroundShells ? bashSchema : (foregroundBashSchema as typeof bashSchema),
		outputSchema: bashOutputSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		async execute(
			toolCallId,
			{ command, timeout, run_in_background }: BashToolInput,
			signal?: AbortSignal,
			onUpdate?,
			ctx?: ExtensionContext,
		) {
			// Strict schemas send omitted optional arguments as null.
			const timeoutSeconds = timeout ?? undefined;
			if (signal?.aborted) throw new Error("Command aborted");
			const runInBackground = backgroundShells !== undefined && run_in_background === true;
			if (runInBackground) {
				// The call returns before the process could reject a bad timeout, so check it here.
				resolveTimeoutMs(timeoutSeconds);
				backgroundShells.assertCanStart();
			}
			// Only a call the model made directly moves on Ctrl+B. A nested call (id `<parent id>/<n>`)
			// returns to the tool or script that made it, which expects the command's result.
			const promotable =
				backgroundShells !== undefined &&
				!runInBackground &&
				typeof toolCallId === "string" &&
				!toolCallId.includes("/");
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(
				resolvedCommand,
				ctx?.cwd || cwd,
				spawnHook,
				exposeSessionEnvironment,
				ctx,
			);
			const output = new OutputAccumulator({ tempFilePrefix: config.tempFilePrefix });
			let acceptingOutput = true;
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;
			const startedAt = performance.now();

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
						backgroundable: promotable || undefined,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			// The process's output goes wherever `sink` points: to this call while it waits, or to the
			// background shell that owns the process once it moves there.
			let sink = (data: Buffer) => {
				if (!acceptingOutput) return;
				output.append(data);
				scheduleOutputUpdate();
			};
			// Aborting this kills the process. The call's signal is forwarded only while the call owns it.
			const processAbort = new AbortController();

			const finishOutput = async () => {
				acceptingOutput = false;
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				await output.closeTempFile();
				return snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") => {
				const truncation = snapshot.truncation;
				let text = snapshot.content || emptyText;
				let details: BashToolDetails | undefined;
				if (truncation.truncated) {
					details = { truncation, fullOutputPath: snapshot.fullOutputPath };
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(output.getLastLineBytes());
						text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
					} else if (truncation.truncatedBy === "lines") {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
					} else {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
					}
				}
				return { text, details };
			};

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			/** Hand the running process to the background shell manager and describe that to the model. */
			const moveToBackground = (manager: BackgroundShellManager, done: Promise<{ exitCode: number | null }>) => {
				acceptingOutput = false;
				clearUpdateTimer();
				const shell = manager.adopt({
					toolName: config.name,
					command,
					cwd: spawnContext.cwd,
					timeoutSeconds,
					output,
					done,
					abort: processAbort,
				});
				sink = shell.append;
				const movedByUser = !runInBackground;
				const text = movedByUser
					? `The user moved this command to the background, where it keeps running with ID: ${shell.id}. Its output so far and from now on is written to: ${shell.outputPath}\nYou will be notified when it exits.`
					: `Command running in background with ID: ${shell.id}. Output is being written to: ${shell.outputPath}\n${BACKGROUND_STARTED_HINT}`;
				const structuredContent: BashToolOutput = {
					output: "",
					truncated: false,
					full_output_path: shell.outputPath,
					background_task_id: shell.id,
					wall_time_seconds: Math.round((performance.now() - startedAt) / 100) / 10,
				};
				return {
					content: [{ type: "text" as const, text }],
					details: {
						fullOutputPath: shell.outputPath,
						background: { taskId: shell.id, movedByUser },
					} satisfies BashToolDetails,
					structuredContent,
				};
			};

			if (onUpdate) {
				onUpdate({
					content: [],
					details: promotable ? { backgroundable: true } : undefined,
				});
			}

			const done = ops.exec(spawnContext.command, spawnContext.cwd, {
				onData: (data) => sink(data),
				signal: processAbort.signal,
				timeout: timeoutSeconds,
				env: spawnContext.env,
			});
			if (runInBackground) return moveToBackground(backgroundShells, done);

			const forwardAbort = () => processAbort.abort();
			if (signal?.aborted) forwardAbort();
			else signal?.addEventListener("abort", forwardAbort, { once: true });
			let exited = false;
			let promote: (() => void) | undefined;
			const promoted = new Promise<"promoted">((resolve) => {
				promote = () => resolve("promoted");
			});
			const unregisterForeground = (promotable ? backgroundShells : undefined)?.registerForeground(() => {
				// Once the process has exited the call is finishing on its own; there is nothing to move.
				if (exited || signal?.aborted) return false;
				promote?.();
				return true;
			});

			try {
				const settled = done.then(
					(result) => {
						exited = true;
						return { exitCode: result.exitCode };
					},
					(error: unknown) => {
						exited = true;
						return { error };
					},
				);
				const outcome = await Promise.race([settled, promoted]);
				if (outcome === "promoted") {
					signal?.removeEventListener("abort", forwardAbort);
					// Only a registered manager can promote.
					return moveToBackground(backgroundShells as BackgroundShellManager, done);
				}

				if ("error" in outcome) {
					const err = outcome.error;
					const snapshot = await finishOutput();
					const { text } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						throw new Error(appendStatus(text, "Command aborted"));
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						const timeoutSecs = err.message.split(":")[1];
						throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
					}
					throw err;
				}

				const exitCode = outcome.exitCode;
				const snapshot = await finishOutput();
				const { text: outputText, details } = formatOutput(snapshot);
				if (exitCode === null) {
					throw new Error(appendStatus(outputText, "Command terminated without an exit code"));
				}
				const wallTimeSeconds = Math.round((performance.now() - startedAt) / 100) / 10;
				const fullOutput = await output.readFullOutput(STRUCTURED_OUTPUT_MAX_BYTES);
				const structuredContent: BashToolOutput = {
					output: fullOutput.content,
					truncated: fullOutput.truncated,
					...(fullOutput.truncated && snapshot.fullOutputPath ? { full_output_path: snapshot.fullOutputPath } : {}),
					exit_code: exitCode,
					wall_time_seconds: wallTimeSeconds,
				};
				if (exitCode !== 0) {
					return {
						content: [{ type: "text", text: appendStatus(outputText, `Command exited with code ${exitCode}`) }],
						details,
						structuredContent,
						isError: true,
					};
				}
				return { content: [{ type: "text", text: outputText }], details, structuredContent };
			} finally {
				unregisterForeground?.();
				signal?.removeEventListener("abort", forwardAbort);
				clearUpdateTimer();
			}
		},
		...createShellRenderers(config.displayName),
	};
	// A session gives a copy of this definition its own manager (see bindBackgroundShells).
	if (backgroundShells) markBoundTool(definition, backgroundShells);
	else {
		markUnboundTool(definition, (manager) =>
			createShellToolDefinition(cwd, config, { ...options, backgroundShells: manager }),
		);
	}
	return definition;
}

const bashToolConfig: ShellToolConfig = {
	name: "bash",
	label: "bash",
	displayName: "Bash",
	shellName: "bash",
	prompt: "$",
	promptSnippet: bashToolSystemPromptContribution.snippet,
	promptGuidelines: bashToolSystemPromptContribution.guidelines,
	tempFilePrefix: "knightcode-bash",
};

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	return createShellToolDefinition(cwd, bashToolConfig, options);
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	const definition = createBashToolDefinition(cwd, options);
	const tool = wrapToolDefinition(definition);
	Object.assign(tool, {
		promptSnippet: definition.promptSnippet,
		promptGuidelines: definition.promptGuidelines,
	});
	return tool;
}
