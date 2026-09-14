import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { contentText } from "@knightcode/ai";
import {
	type AgentSession,
	CONFIG_DIR_NAME,
	type CreateAgentSessionOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
	type InlineExtension,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@knightcodeai/cli";
import {
	createHarness,
	type Harness,
	type HarnessContext,
	type JsonValue,
	normalizeRecord,
	type SimpleHarnessResult,
	type TranscriptEvent,
	toJsonValue,
} from "vitest-evals/harness";
import { KNIGHTCODE_SESSION_SNAPSHOT_ARTIFACT } from "./vitest-evals/artifacts.ts";

export type KnightCodeHarnessInput = string | Array<{ type: "prompt"; content: string } | { type: "reload" }>;

type KnightCodeModelSelection = {
	provider: string;
	id: string;
};

type KnightCodeHarnessOptions = {
	name?: string;
	model?: KnightCodeModelSelection;
	noTools?: CreateAgentSessionOptions["noTools"];
	tools?: CreateAgentSessionOptions["tools"];
	customTools?: CreateAgentSessionOptions["customTools"];
	transformSystemPrompt?: (defaultPrompt: string) => string;
};

type KnightCodeHarnessWithOutput<TOutput extends JsonValue> = KnightCodeHarnessOptions & {
	output: (args: {
		response: string;
		session: AgentSession;
		systemPrompt: string;
		agentDir: string;
	}) => TOutput | Promise<TOutput>;
};

// Comparative evals intentionally remove the documentation block using stable prompt markers instead of changing
// KnightCode's production prompt builder. The isolated eval prompt has no project context or skills between these
// markers. If that setup changes, this transform must be updated so baseline and candidate still differ only by
// documentation.
export function excludeDocumentation(defaultPrompt: string): string {
	const documentationStart = defaultPrompt.indexOf("\nKnightCode documentation (read only");
	if (documentationStart === -1) throw new Error("Default KnightCode system prompt has no documentation section.");
	const cwdStart = defaultPrompt.lastIndexOf("\nCurrent working directory: ");
	if (cwdStart === -1) throw new Error("Default KnightCode system prompt has no working-directory section.");
	return defaultPrompt.slice(0, documentationStart) + defaultPrompt.slice(cwdStart);
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const SANDBOX_GUARD_EXTENSION = "eval-sandbox-guard";
const SYSTEM_PROMPT_TRANSFORM_EXTENSION = "eval-system-prompt-transform";

export type EvalSandbox = {
	/** Temporary directory holding the eval's workspace and home; the only place file tools may write. */
	root: string;
	cwd: string;
	home: string;
	/** Paths a shell command may not name, such as the repository and the real user's configuration. */
	protectedPaths: readonly string[];
};

// One lower-case, forward-slash spelling, with Git Bash's `/c/...` turned back into `c:/...`.
function comparablePath(value: string): string {
	return value
		.replaceAll("\\", "/")
		.replace(/(^|[\s'"=(])\/([a-z])\//gi, "$1$2:/")
		.toLowerCase();
}

/**
 * Explains why a tool call would leave the eval sandbox, or returns undefined when it may run. The eval workspace is
 * a temporary directory, not a sandbox: an agent without documentation went looking for model definitions, found the
 * repository through the environment, and edited it. `write` and `edit` may only touch files under the eval root, and
 * shell commands may not name a protected path.
 * ponytail: shell commands are matched by text, so a relative `cd ../..` walk is not caught; a real sandbox is the upgrade.
 */
export function describeEvalEscape(
	call: { toolName: string; input: unknown },
	sandbox: EvalSandbox,
): string | undefined {
	const input = (call.input ?? {}) as { path?: unknown; command?: unknown };
	if (call.toolName === "write" || call.toolName === "edit") {
		const path = String(input.path ?? "").replace(/^@/, "");
		const expanded = path === "~" || /^~[/\\]/.test(path) ? join(sandbox.home, path.slice(1)) : path;
		const target = resolve(sandbox.cwd, expanded);
		const fromRoot = relative(sandbox.root, target);
		if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
			return `Blocked by the eval sandbox: ${call.toolName} may only change files under ${sandbox.root}, not ${target}.`;
		}
		return undefined;
	}
	if (call.toolName === "bash" || call.toolName === "powershell") {
		const command = comparablePath(String(input.command ?? ""));
		const named = sandbox.protectedPaths.find((path) => command.includes(comparablePath(path)));
		if (named) return `Blocked by the eval sandbox: shell commands may not reference ${named}.`;
	}
	return undefined;
}

/** A hidden extension that refuses every tool call {@link describeEvalEscape} rejects, telling the model why. */
export function createEvalSandboxGuard(sandbox: EvalSandbox): InlineExtension {
	return {
		name: SANDBOX_GUARD_EXTENSION,
		hidden: true,
		factory: (knightcode) => {
			knightcode.on("tool_call", (event) => {
				const reason = describeEvalEscape(event, sandbox);
				return reason ? { block: true, reason } : undefined;
			});
		},
	};
}

export function resolveModelSelection(
	explicitModel: KnightCodeModelSelection | undefined,
	environment: { KNIGHTCODE_PROVIDER?: string; KNIGHTCODE_MODEL?: string } = process.env,
): KnightCodeModelSelection {
	const provider = (explicitModel?.provider ?? environment.KNIGHTCODE_PROVIDER)?.trim();
	const id = (explicitModel?.id ?? environment.KNIGHTCODE_MODEL)?.trim();
	if (!provider || !id) {
		throw new Error(
			"Select a harness model explicitly or set both KNIGHTCODE_PROVIDER and KNIGHTCODE_MODEL as defaults.",
		);
	}
	return { provider, id };
}

function toTranscriptEvents(messages: AgentSession["messages"]): TranscriptEvent[] {
	const events: TranscriptEvent[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			events.push({ type: "message", role: "user", content: contentText(message.content) });
		} else if (message.role === "assistant") {
			const text = contentText(message.content);
			if (text) events.push({ type: "message", role: "assistant", content: text });
			for (const part of message.content) {
				if (part.type === "toolCall") {
					events.push({
						type: "tool_call",
						id: part.id,
						name: part.name,
						arguments: normalizeRecord(part.arguments),
					});
				}
			}
		} else if (message.role === "toolResult") {
			const text = contentText(message.content);
			events.push({
				type: "tool_result",
				toolCallId: message.toolCallId,
				name: message.toolName,
				content: message.content.every((part) => part.type === "text") ? text : toJsonValue(message.content),
				...(message.isError ? { error: { message: text || "Tool failed" } } : {}),
			});
		}
	}
	return events;
}

async function promptAgent(session: AgentSession, input: string, signal: AbortSignal | undefined): Promise<string> {
	signal?.throwIfAborted();
	const previousMessageCount = session.messages.length;
	await session.prompt(input);
	const assistant = session.messages
		.slice(previousMessageCount)
		.reverse()
		.find((message) => message.role === "assistant");
	if (!assistant) throw new Error("Agent run completed without an assistant message.");
	if (assistant.stopReason !== "stop" && assistant.stopReason !== "toolUse") {
		throw new Error(assistant.errorMessage ?? `Agent run ended with unexpected stop reason: ${assistant.stopReason}.`);
	}
	const output = session.getLastAssistantText();
	if (!output && assistant.stopReason === "stop") throw new Error("Agent run produced no assistant text.");
	return output ?? "";
}

async function runKnightCodeHarness<TOutput extends JsonValue>(
	input: KnightCodeHarnessInput,
	signal: AbortSignal | undefined,
	setArtifact: HarnessContext["setArtifact"],
	options: KnightCodeHarnessOptions | KnightCodeHarnessWithOutput<TOutput>,
): Promise<SimpleHarnessResult<string | TOutput>> {
	const startedAt = performance.now();
	signal?.throwIfAborted();
	const selection = resolveModelSelection(options.model);
	const modelRuntime = await ModelRuntime.create();
	const model = modelRuntime.getModel(selection.provider, selection.id);
	if (!model) throw new Error(`Eval model not found: ${selection.provider}/${selection.id}`);

	const root = await mkdtemp(join(tmpdir(), "knightcode-eval-"));
	const cwd = join(root, "workspace");
	const isolatedHome = join(root, "home");
	const agentDir = join(isolatedHome, CONFIG_DIR_NAME, "agent");
	const transformSystemPrompt = options.transformSystemPrompt;
	let evaluatedSystemPrompt: string | undefined;
	const sandbox: EvalSandbox = {
		root,
		cwd,
		home: isolatedHome,
		protectedPaths: [repositoryRoot, join(homedir(), CONFIG_DIR_NAME)],
	};
	const extensionFactories: InlineExtension[] = [createEvalSandboxGuard(sandbox)];
	if (transformSystemPrompt) {
		extensionFactories.push({
			name: SYSTEM_PROMPT_TRANSFORM_EXTENSION,
			hidden: true,
			factory: (knightcode) => {
				knightcode.on("before_agent_start", (event) => {
					evaluatedSystemPrompt = transformSystemPrompt(event.systemPrompt);
					return { systemPrompt: evaluatedSystemPrompt };
				});
			},
		});
	}
	let sessionManager: SessionManager | undefined;
	let session: AgentSession | undefined;
	let outcome: { success: true; result: SimpleHarnessResult<string | TOutput> } | { success: false; error: unknown };
	// File tools expand `~` with os.homedir(), which reads HOME (USERPROFILE on Windows) from this process, so the
	// exported HOME in bash commands alone still lets `write ~/.knightcode/agent/models.json` reach the real user's
	// configuration. The eval model runtime above has already resolved its credentials from the real home.
	// ponytail: process-wide override, safe only because eval files and tests run one at a time.
	const isolatedEnvironment: Record<string, string> = {
		HOME: isolatedHome,
		USERPROFILE: isolatedHome,
		KNIGHTCODE_CODING_AGENT_DIR: agentDir,
	};
	const previousEnvironment = Object.keys(isolatedEnvironment).map((key) => [key, process.env[key]] as const);
	Object.assign(process.env, isolatedEnvironment);
	try {
		await Promise.all([mkdir(cwd), mkdir(agentDir, { recursive: true })]);
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			modelRuntime,
			settingsManager: SettingsManager.inMemory({
				shellCommandPrefix: `export HOME=${JSON.stringify(isolatedHome)}; unset KNIGHTCODE_CODING_AGENT_DIR KNIGHTCODE_EVAL_ARTIFACT_DIR KNIGHTCODE_MODEL KNIGHTCODE_PROVIDER KNIGHTCODE_REASONING_LEVEL KNIGHTCODE_SESSION_FILE KNIGHTCODE_SESSION_ID;`,
			}),
			resourceLoaderOptions: { extensionFactories },
		});
		signal?.throwIfAborted();
		sessionManager = SessionManager.create(cwd, join(root, "sessions"));
		setArtifact("runId", sessionManager.getSessionId());
		session = (
			await createAgentSessionFromServices({
				services,
				sessionManager,
				model,
				thinkingLevel: "off",
				tools: options.tools,
				noTools: options.noTools,
				customTools: options.customTools,
			})
		).session;

		const evalSession = session;
		let abortPromise: Promise<void> | undefined;
		const abort = () => {
			abortPromise ??= evalSession.abort();
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			signal?.throwIfAborted();
			const unexpectedExtensionPaths = evalSession.extensionRunner
				.getExtensionPaths()
				.filter(
					(path) =>
						path !== `<inline:${SANDBOX_GUARD_EXTENSION}>` && path !== `<inline:${SYSTEM_PROMPT_TRANSFORM_EXTENSION}>`,
				);
			if (unexpectedExtensionPaths.length !== 0) {
				throw new Error("Expected an isolated eval session to start without extensions.");
			}
			const steps = typeof input === "string" ? [{ type: "prompt" as const, content: input }] : input;
			let response: string | undefined;
			for (const step of steps) {
				if (step.type === "prompt") {
					response = await promptAgent(evalSession, step.content, signal);
					if (transformSystemPrompt && !evaluatedSystemPrompt?.trim()) {
						throw new Error("System-prompt transform did not produce a non-empty prompt.");
					}
				} else {
					await evalSession.reload();
				}
			}
			if (response === undefined) throw new Error("KnightCode eval input must include at least one prompt step.");
			const output =
				"output" in options
					? await options.output({
							response,
							session: evalSession,
							systemPrompt: evaluatedSystemPrompt ?? evalSession.systemPrompt,
							agentDir,
						})
					: response;
			const stats = evalSession.getSessionStats();
			const hasPricing = [model.cost, ...(model.cost.tiers ?? [])].some(
				({ input, output, cacheRead, cacheWrite }) => input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0,
			);
			outcome = {
				success: true,
				result: {
					output,
					events: toTranscriptEvents(evalSession.messages),
					usage: {
						provider: model.provider,
						model: model.id,
						inputTokens: stats.tokens.input,
						outputTokens: stats.tokens.output,
						totalTokens: stats.tokens.total,
						toolCalls: stats.toolCalls,
						metadata: {
							cacheReadTokens: stats.tokens.cacheRead,
							cacheWriteTokens: stats.tokens.cacheWrite,
							...(hasPricing ? { estimatedCostUsd: stats.cost } : {}),
						},
					},
				},
			};
		} finally {
			signal?.removeEventListener("abort", abort);
			if (abortPromise) await abortPromise;
		}
	} catch (error) {
		outcome = { success: false, error };
	} finally {
		for (const [key, value] of previousEnvironment) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	const cleanupErrors: unknown[] = [];
	if (sessionManager) {
		try {
			const sessionPath = sessionManager.getSessionFile();
			if (sessionPath && existsSync(sessionPath)) {
				setArtifact(KNIGHTCODE_SESSION_SNAPSHOT_ARTIFACT, await readFile(sessionPath, "utf8"));
			}
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	try {
		session?.dispose();
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await rm(root, { recursive: true, force: true });
	} catch (error) {
		cleanupErrors.push(error);
	}

	if (!outcome.success) {
		if (cleanupErrors.length === 0) throw outcome.error;
		throw new AggregateError([outcome.error, ...cleanupErrors], "Agent run failed and cleanup also failed.");
	}
	if (cleanupErrors.length === 1) throw cleanupErrors[0];
	if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Agent cleanup failed.");
	return {
		...outcome.result,
		timings: { totalMs: performance.now() - startedAt },
	};
}

export function createKnightCodeHarness<TOutput extends JsonValue>(
	options: KnightCodeHarnessWithOutput<TOutput>,
): Harness<KnightCodeHarnessInput, TOutput>;
export function createKnightCodeHarness(options?: KnightCodeHarnessOptions): Harness<KnightCodeHarnessInput, string>;
export function createKnightCodeHarness<TOutput extends JsonValue>(
	options: KnightCodeHarnessOptions | KnightCodeHarnessWithOutput<TOutput> = {},
) {
	return createHarness<KnightCodeHarnessInput, string | TOutput>({
		name: options.name ?? "knightcode",
		run: ({ input, signal, setArtifact }) => runKnightCodeHarness(input, signal, setArtifact, options),
	});
}
