import { fauxAssistantMessage, fauxToolCall, type AssistantMessage, type ImageContent } from "@knightcode/ai";
import { askUserTool } from "@knightcode/tools/ask/tool";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { createAgentSessionServices } from "../src/core/agent-session-services.ts";
import planMode from "../src/extensions/plan-mode/index.ts";
import { createHarness } from "./suite/harness.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionShutdownEvent } from "../src/index.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";

type EmitEvent = SessionShutdownEvent;

type FakeExtensionRunner = {
	hasHandlers: (eventType: string) => boolean;
	emit: ReturnType<typeof vi.fn<(event: EmitEvent) => Promise<void>>>;
};

type FakeSession = {
	sessionManager: { getHeader: () => object | undefined };
	agent: { waitForIdle: () => Promise<void>; subscribe: ReturnType<typeof vi.fn> };
	state: { messages: AssistantMessage[] };
	extensionRunner: FakeExtensionRunner;
	bindExtensions: ReturnType<typeof vi.fn>;
	subscribe: ReturnType<typeof vi.fn>;
	prompt: ReturnType<typeof vi.fn>;
	reload: ReturnType<typeof vi.fn>;
};

type FakeRuntimeHost = {
	session: FakeSession;
	newSession: ReturnType<typeof vi.fn>;
	fork: ReturnType<typeof vi.fn>;
	switchSession: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
	setRebindSession: ReturnType<typeof vi.fn>;
};

function createAssistantMessage(options?: {
	text?: string;
	stopReason?: AssistantMessage["stopReason"];
	errorMessage?: string;
}): AssistantMessage {
	return {
		role: "assistant",
		content: options?.text ? [{ type: "text", text: options.text }] : [],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: options?.stopReason ?? "stop",
		errorMessage: options?.errorMessage,
		timestamp: Date.now(),
	};
}

function createRuntimeHost(assistantMessage: AssistantMessage): FakeRuntimeHost {
	const extensionRunner: FakeExtensionRunner = {
		hasHandlers: (eventType: string) => eventType === "session_shutdown",
		emit: vi.fn(async () => {}),
	};

	const state = { messages: [assistantMessage] };

	const session: FakeSession = {
		sessionManager: { getHeader: () => undefined },
		agent: { waitForIdle: async () => {}, subscribe: vi.fn(() => () => {}) },
		state,
		extensionRunner,
		bindExtensions: vi.fn(async () => {}),
		subscribe: vi.fn(() => () => {}),
		prompt: vi.fn(async () => {}),
		reload: vi.fn(async () => {}),
	};

	return {
		session,
		newSession: vi.fn(async () => undefined),
		fork: vi.fn(async () => ({ selectedText: "" })),
		switchSession: vi.fn(async () => undefined),
		dispose: vi.fn(async () => {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		}),
		setRebindSession: vi.fn(),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runPrintMode", () => {
	it.each(["plain", "mixed", "flag", "json", "approval", "dispatch-failure"] as const)(
		"awaits real planning dispatch and frames %s output before teardown",
		async (kind) => {
			const h = await createHarness({
				extensionFactories: [planMode, (kc) => kc.registerTool({ ...askUserTool, defaultActive: false })],
				withConfiguredAuth: kind !== "dispatch-failure",
			});
			if (kind === "flag") h.session.extensionRunner.setFlagValue("plan", true);
			const services = await createAgentSessionServices({
				cwd: h.tempDir,
				agentDir: h.tempDir,
				modelRuntime: h.session.modelRuntime,
				settingsManager: h.settingsManager,
				resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true },
			});
			const runtime = new AgentSessionRuntime(h.session, services, async () => {
				throw new Error("replacement not expected");
			});
			const plan = "# A complete plan\n\nChange the code and run tests.";
			if (kind === "approval") {
				await h.session.bindExtensions({ mode: "json" });
				h.setResponses([
					fauxAssistantMessage(fauxToolCall("submit_plan", { markdown: plan }), { stopReason: "toolUse" }),
				]);
				await h.session.prompt("/plan task");
			}
			const errors: string[] = [];
			vi.spyOn(console, "error").mockImplementation((text) => errors.push(String(text)));
			const chunks: string[] = [];
			vi.spyOn(process.stdout, "write").mockImplementation((chunk, encodingOrCallback, callback) => {
				chunks.push(String(chunk));
				const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
				done?.();
				return true;
			});
			const call = fauxToolCall("submit_plan", { markdown: plan });
			h.setResponses([
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 20));
					if (kind === "approval") return fauxAssistantMessage("implemented");
					return fauxAssistantMessage(kind === "mixed" ? [fauxToolCall("read", { path: "missing" }), call] : call, {
						stopReason: "toolUse",
					});
				},
			]);
			try {
				expect(
					await runPrintMode(runtime, {
						mode: kind === "json" ? "json" : "text",
						initialMessage: kind === "approval" ? "/plan approve" : kind === "flag" ? "task" : "/plan task",
					}),
				).toBe(kind === "dispatch-failure" ? 1 : 0);
				if (kind === "json") {
					const records = chunks
						.join("")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line) as { type: string });
					expect(records.some((r) => r.type === "tool_execution_end")).toBe(true);
				} else
					expect(chunks.join("")).toBe(
						kind === "dispatch-failure" ? "" : kind === "approval" ? "implemented\n" : plan + "\n",
					);
				if (kind === "dispatch-failure") expect(errors.join("\n")).toContain("API key");
				expect(h.faux.state.callCount).toBe(kind === "dispatch-failure" ? 0 : kind === "approval" ? 2 : 1);
			} finally {
				h.cleanup();
			}
		},
	);

	it("reports fatal plan startup without requesting a provider or printing a plan", async () => {
		const h = await createHarness({ extensionFactories: [planMode], allowedToolNames: [] });
		h.session.extensionRunner.setFlagValue("plan", true);
		const services = await createAgentSessionServices({
			cwd: h.tempDir,
			agentDir: h.tempDir,
			modelRuntime: h.session.modelRuntime,
			settingsManager: h.settingsManager,
			resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true },
		});
		const runtime = new AgentSessionRuntime(h.session, services, async () => {
			throw new Error("replacement not expected");
		});
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((text) => errors.push(String(text)));
		try {
			expect(await runPrintMode(runtime, { mode: "text", initialMessage: "task" })).toBe(1);
			expect(h.faux.state.callCount).toBe(0);
			expect(errors.join("\n")).toContain("Plan mode needs");
		} finally {
			h.cleanup();
		}
	});

	it("emits session_shutdown in text mode", async () => {
		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
		const { session } = runtimeHost;
		const images: ImageContent[] = [{ type: "image", mimeType: "image/png", data: "abc" }];

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
			initialMessage: "Say done",
			initialImages: images,
		});

		expect(exitCode).toBe(0);
		expect(session.prompt).toHaveBeenCalledWith("Say done", { images });
		expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
		expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
	});

	it("emits session_shutdown in json mode", async () => {
		const runtimeHost = createRuntimeHost(createAssistantMessage({ text: "done" }));
		const { session } = runtimeHost;

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "json",
			messages: ["hello"],
		});

		expect(exitCode).toBe(0);
		expect(session.prompt).toHaveBeenCalledWith("hello");
		expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
		expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
	});

	it("emits session_shutdown and returns non-zero on assistant error", async () => {
		const runtimeHost = createRuntimeHost(
			createAssistantMessage({ stopReason: "error", errorMessage: "provider failure" }),
		);
		const { session } = runtimeHost;
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
			mode: "text",
		});

		expect(exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith("provider failure");
		expect(session.extensionRunner.emit).toHaveBeenCalledTimes(1);
		expect(session.extensionRunner.emit).toHaveBeenCalledWith({ type: "session_shutdown", reason: "quit" });
	});
});
