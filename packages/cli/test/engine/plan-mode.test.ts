import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { historyUpdates, createSessionState, toSessionUpdates } from "../../src/engine/acp/updates.ts";
import { createEngineContext } from "../../src/engine/context.ts";
import type { EngineEvent, SessionEvent } from "../../src/engine/events.ts";
import { createSessionRegistry, type SessionRegistry } from "../../src/engine/sessions.ts";

const PLAN = "# Summary\n\nImplement a small, verified patch.";
const submit = () => fauxAssistantMessage(fauxToolCall("submit_plan", { markdown: PLAN }), { stopReason: "toolUse" });

describe("engine planning", () => {
	const dirs: string[] = [];
	let registry: SessionRegistry | undefined;
	afterEach(async () => {
		await registry?.closeAll();
		vi.restoreAllMocks();
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function setup(persisted = false) {
		const dir = mkdtempSync(join(tmpdir(), "kc-engine-plan-"));
		dirs.push(dir);
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-plan-${dirs.length}`, tokensPerSecond: 100000 });
		ctx.models.registerNativeProvider(faux.provider);
		const events: EngineEvent[] = [];
		ctx.events.subscribe((event) => events.push(event));
		registry = createSessionRegistry(ctx, {
			agentDir: dir,
			sessionDir: persisted ? join(dir, "sessions") : null,
			defaultModel: faux.getModel(),
		});
		const count = (type: EngineEvent["type"]) => events.filter((e) => e.type === type).length;
		const settled = async (n: number) => {
			await vi.waitFor(() => expect(count("session.turn_end")).toBe(n));
		};
		return { dir, ctx, faux, events, count, settled, registry };
	}

	it("advertises /plan, acknowledges before settlement, renders live/history Markdown, and awaits approval", async () => {
		const h = await setup();
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const { id, commands } = await h.registry.create({ cwd: h.dir });
		expect(commands.map((c) => c.name)).toContain("plan");
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.faux.setResponses([
			async () => {
				await gate;
				return submit();
			},
			fauxAssistantMessage("implemented"),
		]);
		await h.registry.prompt(id, { text: "/plan task" });
		expect(h.count("session.turn_end")).toBe(0);
		release();
		await h.settled(1);
		expect(h.events.at(-1)?.type).toBe("session.turn_end");
		const state = createSessionState(h.dir);
		const updates = h.events.flatMap((e) =>
			e.type.startsWith("session.") ? toSessionUpdates(e as SessionEvent, state) : [],
		);
		// rawInput and the result details also carry the markdown, so check the rendered card content itself.
		const rendered = [{ type: "content", content: { type: "text", text: PLAN } }];
		for (const card of [updates, historyUpdates(h.registry.messages(id), h.dir)]) {
			expect(card.find((u) => u.sessionUpdate === "tool_call")).toMatchObject({ content: rendered });
		}
		expect(h.count("session.request")).toBe(0);
		await h.registry.prompt(id, { text: "/plan approve" });
		await h.settled(2);
		expect(h.faux.state.callCount).toBe(2);
		expect(h.events.at(-1)?.type).toBe("session.turn_end");
		expect(stdout).not.toHaveBeenCalled();
	});

	it("blocks mutation before permissions, and questions take recorded assumptions", async () => {
		const h = await setup();
		const { id } = await h.registry.create({ cwd: h.dir });
		h.faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "bad", content: "bad" }),
					fauxToolCall("ask_user", {
						questions: [
							{
								id: "choice",
								question: "Which design?",
								options: [
									{ label: "Patch (Recommended)", description: "Small change" },
									{ label: "Rewrite", description: "Large change" },
								],
							},
						],
					}),
				],
				{ stopReason: "toolUse" },
			),
			submit(),
		]);
		await h.registry.prompt(id, { text: "/plan task" });
		await h.settled(1);
		expect(h.count("session.request")).toBe(0);
		const results = h.events.filter((e) => e.type === "session.tool_end");
		expect(results.filter((e) => e.isError).map((e) => e.toolName)).toEqual(["write"]);
		expect(JSON.stringify(results)).toContain("as an assumption");
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		await h.registry.prompt(id, { text: "/plan approve fresh" });
		await h.settled(2);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Fresh-session handoff is not available"));
		expect(h.faux.state.callCount).toBe(2);
	});

	it("rejects preflight without a completion event", async () => {
		const h = await setup();
		const { id } = await h.registry.create({ cwd: h.dir });
		vi.spyOn(h.ctx.models, "hasConfiguredAuth").mockReturnValue(false);
		vi.spyOn(h.ctx.models, "checkAuth").mockResolvedValue(undefined);
		await expect(h.registry.prompt(id, { text: "/plan task" })).rejects.toThrow(/signed in/i);
		expect(h.count("session.turn_end")).toBe(0);
		expect(h.faux.state.callCount).toBe(0);
	});

	it("accepted command failures finish once after their last update", async () => {
		const h = await setup();
		const { id } = await h.registry.create({ cwd: h.dir });
		h.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider failed" })]);
		await h.registry.prompt(id, { text: "/plan task" });
		await h.settled(1);
		expect(h.events.at(-1)).toMatchObject({ type: "session.turn_end", stopReason: "error", error: "provider failed" });
	});

	it("cancels a command-triggered run and publishes exactly one completion", async () => {
		const h = await setup();
		const { id } = await h.registry.create({ cwd: h.dir });
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.faux.setResponses([
			async () => {
				await gate;
				return submit();
			},
		]);
		await h.registry.prompt(id, { text: "/plan task" });
		const cancel = h.registry.cancel(id);
		release();
		await cancel;
		await h.settled(1);
		expect(h.events.at(-1)).toMatchObject({ type: "session.turn_end", stopReason: "cancelled" });
	});

	it("fatal restoration disposes without announcing a usable session", async () => {
		const h = await setup(true);
		const manager = SessionManager.create(h.dir, join(h.dir, "sessions"));
		manager.appendCustomEntry("plan-mode", { mode: "invalid" });
		manager.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
		manager.appendMessage(fauxAssistantMessage("saved"));
		const disposed = vi.spyOn(AgentSession.prototype, "dispose");
		await expect(h.registry.open({ id: manager.getSessionId(), cwd: h.dir })).rejects.toThrow(/plan/i);
		expect(h.registry.size()).toBe(0);
		expect(h.count("session.created")).toBe(0);
		expect(disposed).toHaveBeenCalledTimes(1);
	});
});
