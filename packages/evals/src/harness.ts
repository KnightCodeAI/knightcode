import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { type Api, contentText, InMemoryCredentialStore, type Model } from "@knightcode/ai";
import { getCurrentSystemPrompt } from "@knightcode/ai/utils/transcript";
import {
	type AgentSession,
	CONFIG_DIR_NAME,
	type CreateAgentSessionOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
	getAgentDir,
	type InlineExtension,
	ModelRuntime,
	readStoredCredential,
	SessionManager,
	SettingsManager,
} from "@knightcodeai/cli";
import {
	attachHarnessRunToError,
	createHarness,
	type Harness,
	type HarnessContext,
	type JsonValue,
	normalizeHarnessRun,
	normalizeRecord,
	type SimpleHarnessResult,
	type TranscriptEvent,
	toJsonValue,
	type UsageSummary,
} from "vitest-evals/harness";
import type { DocumentationVariant } from "./plan.ts";
import { KNIGHTCODE_SESSION_SNAPSHOT_ARTIFACT } from "./report.ts";

type RunDiagnostics = {
	events: TranscriptEvent[];
	metadata: Record<string, unknown>;
	usage: UsageSummary;
};

export type KnightCodeHarnessInput = string | Array<{ type: "prompt"; content: string } | { type: "reload" }>;

export type KnightCodeModelSelection = {
	provider: string;
	id: string;
};

export type KnightCodeHarnessOptions = {
	name?: string;
	model?: KnightCodeModelSelection;
	noTools?: CreateAgentSessionOptions["noTools"];
	tools?: CreateAgentSessionOptions["tools"];
	customTools?: CreateAgentSessionOptions["customTools"];
	workspaceFiles?: Readonly<Record<string, string>>;
	transformSystemPrompt?: (defaultPrompt: string) => string;
	expectedDocumentation?: boolean;
};

export type KnightCodeHarnessWithOutput<TOutput extends JsonValue> = KnightCodeHarnessOptions & {
	output: (args: {
		response: string;
		session: AgentSession;
		systemPrompt: string;
		agentDir: string;
	}) => TOutput | Promise<TOutput>;
};

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

export function applyIsolatedEnvironment(home: string, agentDir: string): () => void {
	const overrides = { HOME: home, USERPROFILE: home, KNIGHTCODE_CODING_AGENT_DIR: agentDir };
	const previous = new Map<string, string | undefined>();
	for (const name of Object.keys(process.env)) {
		if (!name.startsWith("KNIGHTCODE_EVAL_")) continue;
		previous.set(name, process.env[name]);
		delete process.env[name];
	}
	for (const [name, value] of Object.entries(overrides)) {
		if (!previous.has(name)) previous.set(name, process.env[name]);
		process.env[name] = value;
	}
	return () => {
		for (const [name, value] of previous) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	};
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

function toTranscriptEvents(messages: AgentSession["messages"]): TranscriptEvent[] {
	const events: TranscriptEvent[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			events.push({ type: "message", role: "user", content: contentText(message.content) });
			continue;
		}
		if (message.role === "assistant") {
			const text = contentText(message.content);
			if (text) events.push({ type: "message", role: "assistant", content: text });
			for (const part of message.content) {
				if (part.type !== "toolCall") continue;
				events.push({
					type: "tool_call",
					id: part.id,
					name: part.name,
					arguments: normalizeRecord(part.arguments),
				});
			}
			continue;
		}
		if (message.role === "toolResult") {
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

async function seedWorkspace(workspace: string, files: Readonly<Record<string, string>> | undefined): Promise<void> {
	for (const [name, content] of Object.entries(files ?? {})) {
		if (!name || isAbsolute(name)) throw new TypeError(`Invalid workspace fixture path: ${name}`);
		const path = resolve(workspace, name);
		const pathFromWorkspace = relative(workspace, path);
		if (pathFromWorkspace === ".." || pathFromWorkspace.startsWith(`..${sep}`) || isAbsolute(pathFromWorkspace)) {
			throw new TypeError(`Workspace fixture escapes the workspace: ${name}`);
		}
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, { mode: 0o600 });
	}
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

export function verifySystemPrompt(
	systemPrompt: string,
	options: Pick<KnightCodeHarnessOptions, "name" | "expectedDocumentation">,
): string {
	if (options.expectedDocumentation === undefined) return systemPrompt;
	if (!systemPrompt.includes("\n<rules>\n")) {
		throw new Error(`KnightCode system prompt lost its rules in the ${options.name} eval variant.`);
	}
	const hasDocumentation = systemPrompt.includes("\n<docs>\nKnightCode documentation (read only");
	if (hasDocumentation !== options.expectedDocumentation) {
		throw new Error(`KnightCode system prompt does not match the ${options.name} eval variant.`);
	}
	return systemPrompt;
}

function readRunDiagnostics(session: AgentSession, model: Model<Api>, systemPrompt: string): RunDiagnostics {
	const stats = session.getSessionStats();
	const hasPricing = [model.cost, ...(model.cost.tiers ?? [])].some(
		({ input: inputCost, output: outputCost, cacheRead, cacheWrite }) =>
			inputCost > 0 || outputCost > 0 || cacheRead > 0 || cacheWrite > 0,
	);
	return {
		events: toTranscriptEvents(session.messages),
		metadata: { systemPromptSha256: createHash("sha256").update(systemPrompt).digest("hex") },
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
	};
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
	const hostAgentDir = getAgentDir();
	const root = await mkdtemp(join(tmpdir(), "knightcode-eval-"));
	const workspace = join(root, "workspace");
	const isolatedHome = join(root, "home");
	const agentDir = join(isolatedHome, CONFIG_DIR_NAME, "agent");
	const sandbox: EvalSandbox = {
		root,
		cwd: workspace,
		home: isolatedHome,
		protectedPaths: [repositoryRoot, join(homedir(), CONFIG_DIR_NAME)],
	};
	const extensionFactories: InlineExtension[] = [createEvalSandboxGuard(sandbox)];
	let forcedSystemPrompt: string | undefined;
	if (options.transformSystemPrompt) {
		const transform = options.transformSystemPrompt;
		extensionFactories.push({
			name: SYSTEM_PROMPT_TRANSFORM_EXTENSION,
			hidden: true,
			factory: (knightcode) => {
				knightcode.on("before_agent_start", ({ systemPrompt }) => {
					forcedSystemPrompt = transform(systemPrompt);
					return { systemPrompt: forcedSystemPrompt };
				});
			},
		});
	}

	let sessionManager: SessionManager | undefined;
	let session: AgentSession | undefined;
	let result: SimpleHarnessResult<string | TOutput> | undefined;
	let runDiagnostics: RunDiagnostics | undefined;
	let runError: unknown;
	const cleanupErrors: unknown[] = [];
	const restoreEnvironment = applyIsolatedEnvironment(isolatedHome, agentDir);
	try {
		const authPath = join(hostAgentDir, "auth.json");
		const credentials = new InMemoryCredentialStore();
		const storedCredential = readStoredCredential(selection.provider, authPath);
		if (storedCredential) await credentials.modify(selection.provider, async () => storedCredential);
		const modelRuntime = await ModelRuntime.create({ credentials });
		await Promise.all([mkdir(workspace), mkdir(agentDir, { recursive: true })]);
		await seedWorkspace(workspace, options.workspaceFiles);
		const model = modelRuntime.getModel(selection.provider, selection.id);
		if (!model) throw new Error(`Eval model not found: ${selection.provider}/${selection.id}`);
		const auth = await modelRuntime.getAuth(model);
		if (!auth) {
			throw new Error(`Eval model has no configured authentication: ${selection.provider}/${selection.id}`);
		}
		if (!storedCredential && auth.auth.apiKey) {
			await modelRuntime.setRuntimeApiKey(selection.provider, auth.auth.apiKey);
		}
		const services = await createAgentSessionServices({
			cwd: workspace,
			modelRuntime,
			settingsManager: SettingsManager.inMemory({
				shellCommandPrefix: `export HOME=${JSON.stringify(isolatedHome)}; unset KNIGHTCODE_CODING_AGENT_DIR KNIGHTCODE_EVAL_ARTIFACT_DIR KNIGHTCODE_MODEL KNIGHTCODE_PROVIDER KNIGHTCODE_REASONING_LEVEL KNIGHTCODE_SESSION_FILE KNIGHTCODE_SESSION_ID;`,
			}),
			resourceLoaderOptions: { extensionFactories },
		});
		signal?.throwIfAborted();
		sessionManager = SessionManager.create(workspace, join(root, "sessions"));
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

		const expectedInlinePaths = new Set(extensionFactories.map(({ name }) => `<inline:${name}>`));
		const unexpectedExtensions = session.extensionRunner
			.getExtensionPaths()
			.filter((path) => !expectedInlinePaths.has(path));
		if (unexpectedExtensions.length > 0) {
			throw new Error(`Isolated eval loaded unexpected extensions: ${unexpectedExtensions.join(", ")}`);
		}

		let response: string | undefined;
		const steps = typeof input === "string" ? [{ type: "prompt" as const, content: input }] : input;
		let abortPromise: Promise<void> | undefined;
		const abort = () => {
			abortPromise ??= session!.abort();
		};
		signal?.addEventListener("abort", abort, { once: true });
		// A forced prompt is not recorded in the transcript, so use the one the transform
		// extension sent; otherwise the replayed transcript prompt is what the provider received.
		const readSystemPrompt = () => forcedSystemPrompt ?? getCurrentSystemPrompt(session!.messages);
		try {
			for (const step of steps) {
				if (step.type === "reload") {
					await session.reload();
					continue;
				}
				response = await promptAgent(session, step.content, signal);
			}
		} finally {
			signal?.removeEventListener("abort", abort);
			if (abortPromise) await abortPromise;
			// Captured however the steps ended: a provider failure or an unexpected stop reason
			// throws out of promptAgent after the session has already recorded its usage.
			runDiagnostics = readRunDiagnostics(session, model, readSystemPrompt());
		}
		if (response === undefined) {
			throw new Error("KnightCode eval input must include at least one prompt step.");
		}
		const systemPrompt = readSystemPrompt();
		verifySystemPrompt(systemPrompt, options);
		const output = "output" in options ? await options.output({ response, session, systemPrompt, agentDir }) : response;
		result = { output, ...runDiagnostics };
	} catch (error) {
		runError = error;
	} finally {
		if (sessionManager) {
			const sessionPath = sessionManager.getSessionFile();
			if (!sessionPath || !existsSync(sessionPath)) {
				cleanupErrors.push(new Error("KnightCode eval produced no session file."));
			} else {
				try {
					setArtifact(KNIGHTCODE_SESSION_SNAPSHOT_ARTIFACT, await readFile(sessionPath, "utf8"));
				} catch (error) {
					cleanupErrors.push(error);
				}
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
		restoreEnvironment();
	}

	let failure = runError;
	if (runError !== undefined && cleanupErrors.length > 0) {
		failure = new AggregateError([runError, ...cleanupErrors], "Agent run failed and cleanup also failed.");
	} else if (cleanupErrors.length === 1) {
		failure = cleanupErrors[0];
	} else if (cleanupErrors.length > 1) {
		failure = new AggregateError(cleanupErrors, "Agent cleanup failed.");
	}
	if (failure !== undefined) {
		if (runDiagnostics) {
			const partialRun = normalizeHarnessRun(input, {
				...runDiagnostics,
				errors: [failure],
				timings: { totalMs: performance.now() - startedAt },
			});
			throw attachHarnessRunToError(failure, partialRun);
		}
		throw failure;
	}
	if (!result) throw new Error("KnightCode eval completed without a result.");
	return { ...result, timings: { totalMs: performance.now() - startedAt } };
}

export function createKnightCodeHarness<TOutput extends JsonValue>(
	options: KnightCodeHarnessWithOutput<TOutput>,
): Harness<KnightCodeHarnessInput, TOutput>;
export function createKnightCodeHarness(options?: KnightCodeHarnessOptions): Harness<KnightCodeHarnessInput, string>;
export function createKnightCodeHarness<TOutput extends JsonValue>(
	options: KnightCodeHarnessOptions | KnightCodeHarnessWithOutput<TOutput> = {},
): Harness<KnightCodeHarnessInput, string | TOutput> {
	return createHarness<KnightCodeHarnessInput, string | TOutput>({
		name: options.name ?? "knightcode",
		run: ({ input, signal, setArtifact }) => runKnightCodeHarness(input, signal, setArtifact, options),
	});
}

/** Documentation evals intentionally exclude shell and unrestricted network tools. */
export const DOCUMENTATION_EVAL_TOOLS = ["read", "write", "edit", "grep", "find", "ls"] as const;

export function resolveDocumentationVariant(
	value: string | undefined = process.env.KNIGHTCODE_EVAL_VARIANT,
): DocumentationVariant {
	if (value === "without_docs" || value === "with_docs") return value;
	throw new TypeError('KNIGHTCODE_EVAL_VARIANT must be "without_docs" or "with_docs".');
}

export function excludeDocumentation(defaultPrompt: string): string {
	const documentationStartMarker = "\n<docs>\n";
	const documentationEndMarker = "\n</docs>";
	const documentationStart = defaultPrompt.indexOf(documentationStartMarker);
	if (documentationStart === -1)
		throw new Error("Default KnightCode system prompt has no KnightCode documentation section.");
	const documentationEnd = defaultPrompt.indexOf(documentationEndMarker, documentationStart);
	if (documentationEnd === -1)
		throw new Error("Default KnightCode system prompt has no complete KnightCode documentation section.");
	const cwdStart = defaultPrompt.lastIndexOf("\n<cwd>\n");
	if (cwdStart < documentationEnd)
		throw new Error("Default KnightCode system prompt has no working-directory section.");
	return (
		defaultPrompt.slice(0, documentationStart) + defaultPrompt.slice(documentationEnd + documentationEndMarker.length)
	);
}

type DocumentationHarnessOptions = Omit<
	KnightCodeHarnessOptions,
	"name" | "transformSystemPrompt" | "expectedDocumentation"
>;
type DocumentationHarnessWithOutput<TOutput extends JsonValue> = Omit<
	KnightCodeHarnessWithOutput<TOutput>,
	"name" | "transformSystemPrompt" | "expectedDocumentation"
>;

export function createDocumentationEvalHarness<TOutput extends JsonValue>(
	options: DocumentationHarnessWithOutput<TOutput>,
): Harness<KnightCodeHarnessInput, TOutput>;
export function createDocumentationEvalHarness(
	options?: DocumentationHarnessOptions,
): Harness<KnightCodeHarnessInput, string>;
export function createDocumentationEvalHarness<TOutput extends JsonValue>(
	options: DocumentationHarnessOptions | DocumentationHarnessWithOutput<TOutput> = {},
) {
	const variant = resolveDocumentationVariant();
	return createKnightCodeHarness({
		...options,
		name: variant,
		tools: options.tools ?? [...DOCUMENTATION_EVAL_TOOLS],
		...(variant === "without_docs" ? { transformSystemPrompt: excludeDocumentation } : {}),
		expectedDocumentation: variant === "with_docs",
	});
}
