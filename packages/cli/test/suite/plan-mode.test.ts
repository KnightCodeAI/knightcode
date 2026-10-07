import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentTools,
	normalizeContext,
	type TranscriptContext,
} from "@knightcode/ai";
import { convertToLlm } from "../../src/core/messages.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, InlineExtension } from "../../src/core/extensions/types.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import toolsExtension from "@knightcode/tools";
import { NO_USER_TEXT } from "@knightcode/tools/ask/tool";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import planMode from "../../src/extensions/plan-mode/index.ts";
import codemode from "../../src/extensions/codemode/index.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../../src/core/agent-session-services.ts";
import { foldPlanState } from "../../src/extensions/plan-mode/state.ts";
import {
	createHarness,
	createTestUiContext,
	getMessageText,
	getToolResult,
	type Harness,
	type HarnessOptions,
} from "./harness.ts";

const PLAN =
	"# Summary\nInvestigate and fix the issue.\n\n# Changes\nChange `src/example.ts`.\n\n# Verification\nRun tests.";
const submission = (markdown = PLAN) =>
	fauxAssistantMessage(fauxToolCall("submit_plan", { markdown }), { stopReason: "toolUse" });

describe("enforced plan mode", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env[ENV_AGENT_DIR];
		while (harnesses.length) harnesses.pop()?.cleanup();
		vi.restoreAllMocks();
	});
	async function setup(options: HarnessOptions = {}, flag = false) {
		const h = await createHarness({
			...options,
			extensionFactories: [planMode, toolsExtension, ...(options.extensionFactories ?? [])],
		});
		harnesses.push(h);
		// ask_user comes from the tools extension, which reads tools.json from the agent dir; never the user's own.
		process.env[ENV_AGENT_DIR] = h.tempDir;
		if (flag) h.session.extensionRunner.setFlagValue("plan", true);
		await h.session.bindExtensions({ mode: "json" });
		return h;
	}
	const state = (h: Harness) => foldPlanState(h.sessionManager.getBranch());
	const snapshots = (h: Harness) =>
		h.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === "plan-mode");

	it.each([false, true])(
		"fresh handoff uses the replacement context and keeps its approval on dispatch failure (%s)",
		async (fail) => {
			const h = await setup({
				models: [
					{ id: "faux-1", reasoning: true },
					{ id: "faux-2", reasoning: true },
				],
			});
			await h.session.setModel(h.getModel("faux-2")!);
			h.session.setThinkingLevel("high");
			h.setResponses([
				submission(),
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 20));
					return fauxAssistantMessage("fresh implementation");
				},
			]);
			await h.session.prompt("/plan task");
			const services = await createAgentSessionServices({
				cwd: h.tempDir,
				agentDir: h.tempDir,
				modelRuntime: h.session.modelRuntime,
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noContextFiles: true,
					extensionFactories: [planMode],
				},
			});
			const runtime = new AgentSessionRuntime(h.session, services, async (options) => {
				const result = await createAgentSessionFromServices({
					services,
					sessionManager: options.sessionManager,
					sessionStartEvent: options.sessionStartEvent,
					model: h.getModel(),
				});
				if (fail) vi.spyOn(result.session.modelRuntime, "checkAuth").mockResolvedValue(undefined);
				return { ...result, services, diagnostics: [] };
			});
			const bind = async () => {
				await runtime.session.bindExtensions({
					mode: "json",
					commandContextActions: {
						waitForIdle: () => runtime.session.agent.waitForIdle(),
						newSession: (options) => runtime.newSession(options),
						fork: (id, options) => runtime.fork(id, options),
						navigateTree: (id, options) => runtime.session.navigateTree(id, options),
						switchSession: (path, options) => runtime.switchSession(path, options),
						reload: () => runtime.session.reload(),
					},
				});
			};
			runtime.setRebindSession(bind);
			await bind();
			const previous = h.sessionManager.getSessionId();
			const accepted: string[] = [];
			try {
				const run = runtime.session.prompt("/plan approve fresh 1", {
					preflightResult: (disposition) => accepted.push(disposition),
				});
				if (fail) await expect(run).rejects.toThrow(/API key/i);
				else await run;
				expect(runtime.session.sessionManager.getSessionId()).not.toBe(previous);
				expect(foldPlanState(runtime.session.sessionManager.getBranch())).toMatchObject({
					mode: "off",
					approved: 1,
					draft: { markdown: PLAN },
				});
				expect(state(h).mode).toBe("planning");
				if (!fail) {
					expect(runtime.session.model?.id).toBe("faux-2");
					expect(runtime.session.thinkingLevel).toBe("high");
					expect(runtime.session.getLastAssistantText()).toBe("fresh implementation");
					expect(runtime.session.messages.filter((m) => m.role === "user")).toHaveLength(1);
					expect(getMessageText(runtime.session.messages.find((m) => m.role === "user"))).toContain(PLAN);
					expect(accepted).toEqual(["started"]);
				} else expect(accepted).toEqual([]);
			} finally {
				await runtime.dispose();
			}
		},
	);

	it("cancelled fresh replacement leaves the original planning snapshot untouched", async () => {
		const h = await setup({
			extensionFactories: [
				(kc) => {
					kc.on("session_before_switch", () => ({ cancel: true }));
				},
			],
		});
		h.setResponses([submission()]);
		await h.session.prompt("/plan task");
		const original = snapshots(h);
		await h.session.bindExtensions({
			commandContextActions: {
				waitForIdle: async () => {},
				newSession: async () => ({ cancelled: true }),
				fork: async () => ({ cancelled: true }),
				navigateTree: async () => ({ cancelled: true }),
				switchSession: async () => ({ cancelled: true }),
				reload: async () => {},
			},
		});
		await h.session.prompt("/plan approve fresh");
		expect(snapshots(h)).toEqual(original);
		expect(state(h).mode).toBe("planning");
		expect(h.faux.state.callCount).toBe(1);
	});

	it("opens TUI review automatically after settlement but never on restoration", async () => {
		const h = await setup();
		let opened = 0;
		h.session.extensionRunner.setUIContext(
			createTestUiContext({
				custom: async <T>() => {
					opened++;
					return undefined as T;
				},
			}),
			"tui",
		);
		h.setResponses([submission()]);
		await h.session.prompt("/plan task");
		expect(opened).toBe(1);
		const restored = await setup({ sessionManager: h.sessionManager });
		restored.session.extensionRunner.setUIContext(
			createTestUiContext({
				custom: async <T>() => {
					opened++;
					return undefined as T;
				},
			}),
			"tui",
		);
		await restored.session.extensionRunner.emit({ type: "session_start", reason: "resume" });
		expect(opened).toBe(1);
	});

	it("RPC review can approve the displayed revision and waits for implementation", async () => {
		const h = await setup();
		h.session.extensionRunner.setUIContext(createTestUiContext({ select: async (_title, rows) => rows[0] }), "rpc");
		h.setResponses([submission(), fauxAssistantMessage("implemented from RPC")]);
		await h.session.prompt("/plan task");
		await h.session.prompt("/plan");
		expect(h.session.getLastAssistantText()).toBe("implemented from RPC");
		expect(state(h)).toMatchObject({ mode: "off", approved: 1 });
	});

	it("an open review is cancelled on shutdown and cannot approve a replaced session", async () => {
		const h = await setup();
		h.setResponses([submission()]);
		await h.session.prompt("/plan task");
		let mounted = false;
		h.session.extensionRunner.setUIContext(
			createTestUiContext({
				custom: async <T>(factory: Parameters<ReturnType<typeof createTestUiContext>["custom"]>[0]) => {
					let component: Awaited<ReturnType<typeof factory>> | undefined;
					try {
						return await new Promise<T>((resolve) => {
							const created = factory(
								{ requestRender() {}, terminal: { rows: 24 } } as never,
								h.session.extensionRunner.getUIContext().theme,
								new KeybindingsManager(),
								resolve as never,
							);
							Promise.resolve(created).then((value) => {
								component = value;
								mounted = true;
							});
						});
					} finally {
						component?.dispose?.();
					}
				},
			}),
			"tui",
		);
		const review = h.session.prompt("/plan");
		await vi.waitFor(() => expect(mounted).toBe(true));
		await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
		await review;
		expect(state(h).mode).toBe("planning");
	});

	it("approval is explicit, stale revisions refuse, and implementation is awaited", async () => {
		const h = await setup();
		const notices: string[] = [];
		h.session.extensionRunner.setUIContext(createTestUiContext({ notify: (text) => notices.push(text) }), "rpc");
		h.setResponses([submission(), fauxAssistantMessage("implemented")]);
		await h.session.prompt("/plan task");
		await h.session.prompt("/plan approve 2");
		expect(state(h).mode).toBe("planning");
		expect(notices).toContain("The plan changed; run /plan to review the latest revision.");
		await h.session.prompt("/plan approve 1");
		expect(h.faux.state.callCount).toBe(2);
		expect(h.session.getLastAssistantText()).toBe("implemented");
		expect(state(h)).toMatchObject({ mode: "off", approved: 1, draft: { markdown: PLAN } });
	});

	it("preserves approval when implementation dispatch fails", async () => {
		const h = await setup();
		h.setResponses([submission()]);
		await h.session.prompt("/plan task");
		h.session.agent.state.model = { ...h.getModel(), provider: "unconfigured-test-provider" };
		await expect(h.session.prompt("/plan approve")).rejects.toThrow(/API key/i);
		expect(state(h)).toMatchObject({ mode: "off", approved: 1 });
	});

	it.each(["planning", "approved"] as const)("appends one frozen %s recovery after each compaction", async (mode) => {
		const h = await setup({
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
			extensionFactories: [
				(kc) => {
					kc.on("session_before_compact", (event) => ({
						compaction: {
							summary: "compact summary",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					}));
				},
			],
		});
		h.setResponses(
			mode === "approved"
				? [submission(), fauxAssistantMessage("implemented")]
				: [submission(), submission("# Replacement")],
		);
		await h.session.prompt("/plan task");
		if (mode === "approved") await h.session.prompt("/plan approve");
		await h.session.compact();
		const recovery = h.sessionManager
			.getBranch()
			.filter((e) => e.type === "custom_message" && (e.details as { kind?: string })?.kind === "recovery");
		expect(recovery).toHaveLength(1);
		const frozen = JSON.stringify(recovery[0]);
		expect(frozen).toContain(PLAN.replaceAll("\n", "\\n"));
		expect(frozen).toContain(mode);
		if (mode === "planning") {
			await h.session.prompt("replace the plan");
			expect(state(h).draft).toEqual({ revision: 2, markdown: "# Replacement" });
			expect(JSON.stringify(recovery[0])).toBe(frozen);
		}
		const restored = await setup({ sessionManager: h.sessionManager });
		expect(
			restored.sessionManager
				.getBranch()
				.filter((e) => e.type === "custom_message" && (e.details as { kind?: string })?.kind === "recovery"),
		).toHaveLength(1);
		if (mode === "approved") {
			h.setResponses([fauxAssistantMessage("next task")]);
			await h.session.prompt("next task");
		}
		await h.session.compact();
		const all = h.sessionManager
			.getBranch()
			.filter((e) => e.type === "custom_message" && (e.details as { kind?: string })?.kind === "recovery");
		expect(all).toHaveLength(2);
		expect(JSON.stringify(all[0])).toBe(frozen);
		expect(JSON.stringify(all[1])).toContain(mode === "planning" ? "# Replacement" : "Approved plan (revision 1)");
	});

	it("projects frozen recovery at the tail of an overflow retry without altering system deltas", async () => {
		const requests: TranscriptContext[] = [];
		const h = await setup({
			models: [{ id: "faux-1", contextWindow: 4000, maxTokens: 100 }],
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
			extensionFactories: [
				(kc) => {
					kc.on("session_before_compact", (event) => ({
						compaction: {
							summary: "overflow summary",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					}));
				},
			],
		});
		h.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "prompt is too long" }),
			(ctx) => {
				requests.push(ctx);
				return submission();
			},
		]);
		await h.session.prompt("/plan " + "task ".repeat(2000));
		expect(requests).toHaveLength(1);
		expect(getMessageText(requests[0].messages.at(-1))).toContain("<plan_mode>");
		expect(requests[0].messages[0].role).toBe("system");
		expect(getCurrentTools(requests[0].messages).map((t) => t.name)).toContain("submit_plan");
		expect(
			h.sessionManager
				.getBranch()
				.filter((e) => e.type === "custom_message" && (e.details as { kind?: string })?.kind === "recovery"),
		).toHaveLength(1);
		const persisted = normalizeContext({ messages: convertToLlm(h.session.messages) }).messages;
		h.setResponses([
			(ctx) => {
				requests.push(ctx);
				return submission("# Updated");
			},
		]);
		await h.session.prompt("revise");
		expect(requests[1].messages.slice(0, persisted.length)).toEqual(persisted);
	});

	it("repairs recovery lost before deferred persistence on resume", async () => {
		const manager = SessionManager.inMemory();
		manager.appendCustomEntry("plan-mode", { mode: "off", draft: { revision: 4, markdown: PLAN }, approved: 4 });
		manager.appendCompaction("old summary", null, 100);
		const h = await setup({ sessionManager: manager });
		const recoveries = h.sessionManager
			.getBranch()
			.filter((e) => e.type === "custom_message" && (e.details as { kind?: string })?.kind === "recovery");
		expect(recoveries).toHaveLength(1);
		expect(JSON.stringify(recoveries[0])).toContain("Approved plan (revision 4)");
	});

	it.each(["shell", "question"] as const)("aborting a %s dialog releases the planning run", async (kind) => {
		const h = await setup();
		let opened = false;
		h.session.extensionRunner.setUIContext(
			createTestUiContext({
				confirm: async (_title, _message, opts) =>
					await new Promise<boolean>((resolve) => {
						opened = true;
						opts?.signal?.addEventListener("abort", () => resolve(false), { once: true });
					}),
				select: async (_title, _rows, opts) =>
					await new Promise<string | undefined>((resolve) => {
						opened = true;
						opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
					}),
			}),
			"rpc",
		);
		h.setResponses([
			fauxAssistantMessage(
				kind === "shell"
					? fauxToolCall("bash", { command: "echo blocked" })
					: fauxToolCall("ask_user", {
							questions: [
								{
									id: "choice",
									question: "Choose?",
									options: [
										{ label: "Patch (Recommended)", description: "Small change" },
										{ label: "Rewrite", description: "Large change" },
									],
								},
							],
						}),
				{ stopReason: "toolUse" },
			),
		]);
		const run = h.session.prompt("/plan task");
		await vi.waitFor(() => expect(opened).toBe(true));
		await h.session.abort();
		await run;
		expect(h.session.isIdle).toBe(true);
		expect(state(h)).toEqual({ mode: "planning" });
		expect(h.eventsOfType("agent_settled")).toHaveLength(1);
	});

	it.each(["on", "only"] as const)("validates the real codemode %s declarations on entry", async (mode) => {
		const h = await setup({
			settings: { codemode: { mode } },
			initialActiveToolNames: ["read", "codemode"],
			extensionFactories: [codemode],
		});
		if (mode === "only") {
			const active = h.session.getActiveToolNames();
			await expect(h.session.prompt("/plan task")).rejects.toThrow(/direct read tools/);
			expect(h.session.getActiveToolNames()).toEqual(active);
			expect(state(h)).toEqual({ mode: "off" });
		} else {
			let request: TranscriptContext | undefined;
			h.setResponses([
				(ctx) => {
					request = ctx;
					return submission();
				},
			]);
			await h.session.prompt("/plan task");
			expect(getCurrentTools(request!.messages).map((t) => t.name)).toEqual(
				expect.arrayContaining(["read", "grep", "find", "ls", "submit_plan"]),
			);
		}
	});

	it("cancels incompatible tree restoration before changing the branch or loadout", async () => {
		const manager = SessionManager.inMemory();
		const target = manager.appendCustomEntry("plan-mode", { mode: "planning" });
		manager.appendCustomEntry("plan-mode", { mode: "off" });
		const h = await setup({ sessionManager: manager, excludedToolNames: ["submit_plan"] });
		const leaf = manager.getLeafId();
		const active = h.session.getActiveToolNames();
		expect(await h.session.navigateTree(target, { summarize: false })).toMatchObject({ cancelled: true });
		expect(manager.getLeafId()).toBe(leaf);
		expect(h.session.getActiveToolNames()).toEqual(active);
	});

	it("stale review and queued input cannot approve a plan", async () => {
		const h = await setup();
		h.setResponses([submission()]);
		await h.session.prompt("/plan task");
		const notices: string[] = [];
		h.session.extensionRunner.setUIContext(
			createTestUiContext({
				notify: (text) => notices.push(text),
				select: async (_title, rows) => {
					h.sessionManager.appendCustomEntry("plan-mode", {
						mode: "planning",
						draft: { revision: 2, markdown: "# New" },
					});
					return rows[0];
				},
			}),
			"rpc",
		);
		await h.session.prompt("/plan");
		expect(notices).toContain("The plan changed; run /plan to review the latest revision.");
		await h.session.followUp("queued");
		await h.session.prompt("/plan approve");
		expect(notices).toContain("Finish or interrupt the current turn first.");
		expect(state(h)).toMatchObject({ mode: "planning", draft: { revision: 2 } });
		expect(h.faux.state.callCount).toBe(1);
	});

	it("applies --plan only on initial startup and preserves explicit exit through reload", async () => {
		const h = await createHarness({ extensionFactories: [planMode, toolsExtension] });
		harnesses.push(h);
		process.env[ENV_AGENT_DIR] = h.tempDir;
		h.session.extensionRunner.setFlagValue("plan", true);
		await h.session.bindExtensions({ mode: "json" });
		expect(snapshots(h)).toHaveLength(1);
		await h.session.prompt("/plan off");
		await h.session.reload();
		expect(state(h).mode).toBe("off");
		for (const reason of ["new", "resume", "fork"] as const) {
			h.session.extensionRunner.setFlagValue("plan", true);
			await h.session.extensionRunner.emit({ type: "session_start", reason });
			expect(state(h).mode).toBe("off");
		}
		expect(snapshots(h)).toHaveLength(2);
	});

	it("costs no declarations or planning instructions when unused", async () => {
		const h = await setup();
		let request: TranscriptContext | undefined;
		h.setResponses([
			(ctx) => {
				request = ctx;
				return fauxAssistantMessage("done");
			},
		]);
		await h.session.prompt("hello");
		expect(getCurrentTools(request!.messages).map((t) => t.name)).not.toContain("submit_plan");
		expect(JSON.stringify(request)).not.toContain("<plan_mode>");
	});

	it("adds one initialization checkpoint and never removes the planning loadout", async () => {
		const h = await setup();
		h.setResponses([fauxAssistantMessage("before"), submission(), fauxAssistantMessage("implemented"), submission()]);
		await h.session.prompt("hello");
		await h.session.prompt("/plan investigate");
		const systems = h.session.messages.filter((m) => m.role === "system");
		expect(systems).toHaveLength(2);
		expect(systems[1].toolsAdded?.map((t) => t.name).sort()).toEqual(["ask_user", "find", "grep", "ls", "submit_plan"]);
		expect(Object.keys(systems[1].sections ?? {}).sort()).toEqual(["rules", "tools"]);
		await h.session.prompt("/plan off");
		await h.session.prompt("/plan");
		await h.session.prompt("/plan approve");
		await h.session.prompt("/plan another task");
		expect(h.session.messages.filter((m) => m.role === "system")).toHaveLength(2);
	});

	it("activates real read tools for headless planning and blocks file mutation", async () => {
		const h = await setup();
		writeFileSync(join(h.tempDir, "example.txt"), "fixture");
		const requests: TranscriptContext[] = [];
		h.setResponses([
			(ctx) => {
				requests.push(ctx);
				return fauxAssistantMessage(
					[
						fauxToolCall("ls", { path: "." }),
						fauxToolCall("write", { path: "unsafe.txt", content: "bad" }),
						fauxToolCall("edit", { path: "example.txt", edits: [{ oldText: "fixture", newText: "bad" }] }),
						fauxToolCall("bash", { command: "echo bad" }),
					],
					{ stopReason: "toolUse" },
				);
			},
			submission(),
			fauxAssistantMessage("must not run"),
		]);
		await h.session.prompt("/plan inspect");
		expect(getCurrentTools(requests[0].messages).map((t) => t.name)).toEqual(
			expect.arrayContaining(["grep", "find", "ls"]),
		);
		expect(getToolResult(h, "ls").isError).toBe(false);
		for (const name of ["write", "edit", "bash"]) expect(getToolResult(h, name).isError).toBe(true);
		expect(existsSync(join(h.tempDir, "unsafe.txt"))).toBe(false);
		expect(h.faux.state.callCount).toBe(2);
		expect(state(h)).toMatchObject({ mode: "planning", draft: { revision: 1, markdown: PLAN } });
	});

	it.each(["read-first", "submit-first", "two-submissions", "unknown-first", "invalid-first"])(
		"ends successful submission batches: %s",
		async (kind) => {
			const h = await setup();
			const submit = fauxToolCall("submit_plan", { markdown: PLAN });
			const read = fauxToolCall("read", { path: "missing" });
			const calls =
				kind === "read-first"
					? [read, submit]
					: kind === "submit-first"
						? [submit, read]
						: kind === "two-submissions"
							? [submit, fauxToolCall("submit_plan", { markdown: "second" })]
							: kind === "unknown-first"
								? [fauxToolCall("unknown", {}), submit]
								: [fauxToolCall("read", {}), submit];
			h.setResponses([fauxAssistantMessage(calls, { stopReason: "toolUse" }), fauxAssistantMessage("must not run")]);
			await h.session.prompt("/plan inspect");
			expect(h.faux.state.callCount).toBe(1);
			expect(state(h).draft).toEqual({ revision: 1, markdown: PLAN });
			expect(h.session.messages.filter((m) => m.role === "toolResult")).toHaveLength(2);
			if (kind === "read-first" || kind === "submit-first") expect(getToolResult(h, "read").isError).toBe(true);
		},
	);

	it.each(["   ", undefined])("allows correction after a failed designated submission (%s)", async (markdown) => {
		const h = await setup();
		h.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("submit_plan", markdown === undefined ? {} : { markdown }),
					fauxToolCall("submit_plan", { markdown: "must not become a draft" }),
				],
				{ stopReason: "toolUse" },
			),
			submission(),
			fauxAssistantMessage("must not run"),
		]);
		await h.session.prompt("/plan task");
		expect(h.faux.state.callCount).toBe(2);
		expect(state(h).draft).toEqual({ revision: 1, markdown: PLAN });
	});

	it.each(["length", "aborted"] as const)("never persists a %s submission", async (stopReason) => {
		const h = await setup({ settings: { compaction: { enabled: false } } });
		h.setResponses([
			fauxAssistantMessage(fauxToolCall("submit_plan", { markdown: PLAN }), { stopReason }),
			fauxAssistantMessage("correct later"),
		]);
		await h.session.prompt("/plan task");
		expect(state(h).draft).toBeUndefined();
	});

	it("records recommended assumptions when no user is available", async () => {
		const h = await setup();
		h.setResponses([
			fauxAssistantMessage(
				fauxToolCall("ask_user", {
					questions: [
						{
							id: "choice",
							question: "Which approach?",
							options: [
								{ label: "Small patch (Recommended)", description: "Keep the scope small." },
								{ label: "Rewrite", description: "Replace the implementation." },
							],
						},
					],
				}),
				{ stopReason: "toolUse" },
			),
			submission(),
		]);
		await h.session.prompt("/plan task");
		expect(getMessageText(getToolResult(h, "ask_user"))).toBe(NO_USER_TEXT);
	});

	it("refuses entry atomically if required tools are excluded", async () => {
		const h = await setup({ excludedToolNames: ["submit_plan"] });
		const active = h.session.getActiveToolNames();
		await expect(h.session.prompt("/plan task")).rejects.toThrow(/Plan mode needs/);
		expect(state(h)).toEqual({ mode: "off" });
		expect(h.session.getActiveToolNames()).toEqual(active);
		expect(h.session.messages).toEqual([]);
	});

	it("fails initial --plan and saved planning closed with no tools", async () => {
		const h = await createHarness({ allowedToolNames: [], extensionFactories: [planMode] });
		harnesses.push(h);
		h.session.extensionRunner.setFlagValue("plan", true);
		await expect(h.session.bindExtensions({ mode: "json" })).rejects.toThrow(/Plan mode needs/);
		await expect(h.session.prompt("task")).rejects.toThrow(/Plan mode needs/);
		expect(h.faux.state.callCount).toBe(0);
	});

	it("persists entry before any request and restores its missing loadout", async () => {
		const h = await setup();
		await h.session.prompt("/plan");
		const restored = await setup({ sessionManager: h.sessionManager });
		let request: TranscriptContext | undefined;
		restored.setResponses([
			(ctx) => {
				request = ctx;
				return submission();
			},
		]);
		await restored.session.prompt("task");
		expect(getCurrentTools(request!.messages).map((t) => t.name)).toContain("submit_plan");
		expect(JSON.stringify(request)).toContain("<plan_mode>");
		expect(snapshots(restored)).toHaveLength(2);
	});

	it("refuses no-draft review without dispatch or changing snapshots", async () => {
		const h = await setup();
		const notices: string[] = [];
		let dialogs = 0;
		h.session.extensionRunner.setUIContext(
			createTestUiContext({
				notify: (text) => notices.push(text),
				select: async () => {
					dialogs++;
					return undefined;
				},
			}),
			"rpc",
		);
		await h.session.prompt("/plan");
		await h.session.prompt("/plan");
		await h.session.prompt("/plan approve");
		expect(notices).toEqual(["No plan submitted yet; send a task to continue planning.", "No plan to approve."]);
		expect(dialogs).toBe(0);
		expect(snapshots(h)).toHaveLength(1);
		expect(h.faux.state.callCount).toBe(0);
	});

	it("default-denies unknown, custom, MCP, codemode and nested tools", async () => {
		const h = await setup();
		await h.session.prompt("/plan");
		for (const name of ["unknown", "custom", "mcp__docs__read", "codemode", "tool_search", "edit", "write"]) {
			const result = await h.session.extensionRunner.emitToolCall({
				type: "tool_call",
				toolName: name,
				toolCallId: "outer/1",
				parentToolCallId: "outer",
				input: {},
			});
			expect(result).toMatchObject({ block: true });
		}
		for (const name of ["read", "grep", "find", "ls", "websearch", "webfetch"]) {
			expect(
				await h.session.extensionRunner.emitToolCall({
					type: "tool_call",
					toolName: name,
					toolCallId: "read",
					input: {},
				}),
			).toBeUndefined();
		}
	});

	it.each([true, false])("requires shell confirmation (allow=%s) without approving the plan", async (allow) => {
		const h = await setup();
		await h.session.prompt("/plan");
		let warning = "";
		h.session.extensionRunner.setUIContext(
			createTestUiContext({
				confirm: async (_title, message) => {
					warning = message;
					return allow;
				},
			}),
			"rpc",
		);
		const result = await h.session.extensionRunner.emitToolCall({
			type: "tool_call",
			toolName: "bash",
			toolCallId: "shell",
			input: { command: "git diff" },
		});
		expect(result?.block ?? false).toBe(!allow);
		expect(warning).toContain("may change files");
		expect(warning).toContain("git diff");
		expect(state(h).mode).toBe("planning");
	});
});
