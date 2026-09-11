import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@knightcode/ai";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext } from "../../src/engine/context.ts";
import type { EngineEvent } from "../../src/engine/events.ts";
import { createSessionRegistry, SessionError, type SessionRegistry } from "../../src/engine/sessions.ts";

type Of<T extends EngineEvent["type"]> = Extract<EngineEvent, { type: T }>;

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("session registry", () => {
	let counter = 0;
	const dirs: string[] = [];
	let registry: SessionRegistry | undefined;

	afterEach(async () => {
		await registry?.closeAll();
		registry = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(options: { tokensPerSecond?: number } = {}) {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-sessions-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-sessions-agent-"));
		dirs.push(cwd, agentDir);
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-sessions-${counter++}`, tokensPerSecond: options.tokensPerSecond });
		ctx.models.registerNativeProvider(faux.provider);
		const seen: EngineEvent[] = [];
		ctx.events.subscribe((event) => seen.push(event));
		// defaultModel pins every session to the faux provider. The root .env is
		// auto-loaded and carries real keys; an unpinned session could bill them.
		const created = createSessionRegistry(ctx, { agentDir, sessionDir: null, defaultModel: faux.getModel() });
		registry = created;
		const events = <T extends EngineEvent["type"]>(type: T): Of<T>[] =>
			seen.filter((event): event is Of<T> => event.type === type);
		const requestsOf = (kind: string) => events("session.request").filter((event) => event.request.kind === kind);
		const turnEnd = async (): Promise<Of<"session.turn_end">> => {
			await until(() => events("session.turn_end").length > 0);
			return events("session.turn_end").at(-1)!;
		};
		return { cwd, faux, seen, registry: created, events, requestsOf, turnEnd };
	}

	const both = { readTextFile: true, writeTextFile: true };

	test("creates a session on the pinned model and announces it", async () => {
		const { cwd, faux, registry, events } = await start();
		const summary = await registry.create({ cwd });
		expect(summary.model?.ref).toBe(`${faux.provider.id}/${faux.getModel().id}`);
		expect(summary.thinkingLevels.length).toBeGreaterThan(0);
		expect(events("session.created")).toEqual([{ type: "session.created", sessionId: summary.id, cwd: summary.cwd }]);
		expect(registry.summary(summary.id)).toEqual(summary);
		expect(registry.size()).toBe(1);
	});

	test("refuses a cwd that is not a directory", async () => {
		const { cwd, registry } = await start();
		await expect(registry.create({ cwd: join(cwd, "missing") })).rejects.toMatchObject({ code: "bad_request" });
		expect(registry.size()).toBe(0);
	});

	test("a prompt streams deltas under one message id and ends with turn_end last", async () => {
		const { cwd, faux, registry, seen, events, turnEnd } = await start();
		const { id } = await registry.create({ cwd });
		faux.setResponses([fauxAssistantMessage([fauxText("hello there friend, how are you today")])]);
		await registry.prompt(id, { text: "hi" });
		const end = await turnEnd();

		expect(end).toMatchObject({ sessionId: id, stopReason: "end_turn" });
		expect(end.usage?.size).toBe(faux.getModel().contextWindow);
		const [message] = events("session.message");
		const deltas = events("session.delta");
		expect(deltas.length).toBeGreaterThan(1);
		expect(deltas.every((delta) => delta.messageId === message.messageId)).toBe(true);
		expect(deltas.map((delta) => delta.delta).join("")).toBe("hello there friend, how are you today");
		expect(seen.at(-1)?.type).toBe("session.turn_end");
	});

	test("a second prompt during a turn is refused as busy", async () => {
		const { cwd, faux, registry, turnEnd } = await start({ tokensPerSecond: 20 });
		const { id } = await registry.create({ cwd });
		faux.setResponses([fauxAssistantMessage([fauxText("a".repeat(400))])]);
		await registry.prompt(id, { text: "slow" });
		await expect(registry.prompt(id, { text: "again" })).rejects.toMatchObject({ code: "busy" });
		await registry.cancel(id);
		await turnEnd();
	});

	test("an edit reads and writes through the client, attributed to its tool call", async () => {
		const { cwd, faux, registry, events, requestsOf, turnEnd, seen } = await start();
		writeFileSync(join(cwd, "a.txt"), "hello world\n");
		const { id } = await registry.create({ cwd, capabilities: both });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxText("edited")]),
		]);
		await registry.prompt(id, { text: "edit it" });

		await until(() => requestsOf("permission").length === 1);
		const permission = requestsOf("permission")[0];
		const [toolCall] = events("session.tool_call");
		expect(permission.request).toMatchObject({ kind: "permission", toolCallId: toolCall.toolCallId, toolName: "edit" });
		registry.reply(id, permission.requestId, { kind: "permission", outcome: "allow_once" });

		await until(() => requestsOf("fs.read").length === 1);
		const read = requestsOf("fs.read")[0];
		expect(read.request).toEqual({ kind: "fs.read", toolCallId: toolCall.toolCallId, path: join(cwd, "a.txt") });
		registry.reply(id, read.requestId, { kind: "fs.read", content: "hello world\n" });

		await until(() => requestsOf("fs.write").length === 1);
		const write = requestsOf("fs.write")[0];
		expect(write.request).toEqual({
			kind: "fs.write",
			toolCallId: toolCall.toolCallId,
			path: join(cwd, "a.txt"),
			content: "hello there\n",
		});
		registry.reply(id, write.requestId, { kind: "fs.write" });

		const end = await turnEnd();
		expect(end.stopReason).toBe("end_turn");
		expect(readFileSync(join(cwd, "a.txt"), "utf-8")).toBe("hello world\n");
		expect(events("session.tool_end")[0]).toMatchObject({ toolCallId: toolCall.toolCallId, isError: false });

		// The order the loop guarantees: the call is announced, execution starts,
		// permission is asked, the tool reads then writes, the call ends.
		const watched: readonly string[] = [
			"session.tool_call",
			"session.tool_start",
			"session.request",
			"session.tool_end",
		];
		const sequence = seen
			.filter((event) => watched.includes(event.type))
			.map((event) => (event.type === "session.request" ? `session.request:${event.request.kind}` : event.type));
		expect(sequence).toEqual([
			"session.tool_call",
			"session.tool_start",
			"session.request:permission",
			"session.request:fs.read",
			"session.request:fs.write",
			"session.tool_end",
		]);
	});

	test("a denied permission fails only that call and the turn goes on", async () => {
		const { cwd, faux, registry, events, requestsOf, turnEnd } = await start();
		const { id } = await registry.create({ cwd, capabilities: both });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("carried on")]),
		]);
		await registry.prompt(id, { text: "write" });
		await until(() => requestsOf("permission").length === 1);
		registry.reply(id, requestsOf("permission")[0].requestId, { kind: "permission", outcome: "reject_once" });
		const end = await turnEnd();
		expect(end.stopReason).toBe("end_turn");
		expect(events("session.tool_end")[0].isError).toBe(true);
		expect(requestsOf("fs.write")).toEqual([]);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
		expect(
			events("session.delta")
				.map((delta) => delta.delta)
				.join(""),
		).toBe("carried on");
	});

	test("cancel ends the turn as cancelled and the session takes the next prompt", async () => {
		const { cwd, faux, registry, events, turnEnd } = await start({ tokensPerSecond: 20 });
		const { id } = await registry.create({ cwd });
		faux.setResponses([fauxAssistantMessage([fauxText("b".repeat(400))])]);
		await registry.prompt(id, { text: "slow" });
		await until(() => events("session.delta").length > 0);
		expect(await registry.cancel(id)).toBe(true);
		expect((await turnEnd()).stopReason).toBe("cancelled");

		faux.setResponses([fauxAssistantMessage([fauxText("again")])]);
		await registry.prompt(id, { text: "next" });
		await until(() => events("session.turn_end").length === 2);
		expect(events("session.turn_end")[1].stopReason).toBe("end_turn");
	});

	test("close rejects parked requests and announces the close", async () => {
		const { cwd, faux, registry, events, requestsOf } = await start();
		const { id } = await registry.create({ cwd, capabilities: both });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("never")]),
		]);
		await registry.prompt(id, { text: "write" });
		await until(() => requestsOf("permission").length === 1);
		const { requestId } = requestsOf("permission")[0];
		expect(await registry.close(id)).toBe(true);
		expect(events("session.closed")).toEqual([{ type: "session.closed", sessionId: id }]);
		expect(registry.size()).toBe(0);
		expect(() => registry.reply(id, requestId, { kind: "permission", outcome: "allow_once" })).toThrow(SessionError);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
	});

	test("without client capabilities the tools use disk and no file requests are made", async () => {
		const { cwd, faux, registry, requestsOf, turnEnd } = await start();
		const { id } = await registry.create({ cwd });
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await registry.prompt(id, { text: "write" });
		await until(() => requestsOf("permission").length === 1);
		registry.reply(id, requestsOf("permission")[0].requestId, { kind: "permission", outcome: "allow_once" });
		await turnEnd();
		expect(readFileSync(join(cwd, "a.txt"), "utf-8")).toBe("hello");
		expect(requestsOf("fs.read")).toEqual([]);
		expect(requestsOf("fs.write")).toEqual([]);
	});

	test("update switches thinking level and reports it", async () => {
		const { cwd, registry } = await start();
		const { id, thinkingLevels } = await registry.create({ cwd });
		const target = thinkingLevels.find((level) => level !== "medium") ?? "off";
		const updated = await registry.update(id, { thinkingLevel: target });
		expect(updated.thinkingLevel).toBe(target);
		await expect(registry.update("nope", {})).rejects.toMatchObject({ code: "not_found" });
	});
});
