import {
	type ActiveSession,
	type ClientConnection,
	client,
	PROTOCOL_VERSION,
	RequestError,
	type RequestPermissionRequest,
	type SessionNotification,
	type SessionUpdate,
	type StopReason,
} from "@agentclientprotocol/sdk";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, type FauxProviderHandle, fauxText, fauxToolCall } from "@knightcode/ai";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAcpAgent } from "../../../src/engine/acp/agent.ts";
import { createEngineClient, type EngineClient } from "../../../src/engine/acp/engine-client.ts";
import { createEngineContext } from "../../../src/engine/context.ts";
import { createEventBus, eventsRoute } from "../../../src/engine/events.ts";
import { modelsRoute } from "../../../src/engine/models.ts";
import { type EngineRoute, type EngineServer, startEngineServer } from "../../../src/engine/server.ts";
import { sessionRoutes } from "../../../src/engine/session-routes.ts";
import { createSessionRegistry, type SessionRegistry } from "../../../src/engine/sessions.ts";

type Decision = (request: RequestPermissionRequest) => "allow_once" | "allow_always" | "reject_once";

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Read updates until the turn stops. */
async function collect(session: ActiveSession): Promise<{ updates: SessionUpdate[]; stopReason: StopReason }> {
	const updates: SessionUpdate[] = [];
	for (;;) {
		const message = await session.nextUpdate();
		if (message.kind === "stop") return { updates, stopReason: message.stopReason };
		updates.push(message.update);
	}
}

function textOf(updates: readonly SessionUpdate[], kind: "agent_message_chunk" | "agent_thought_chunk"): string {
	return updates
		.filter((update) => update.sessionUpdate === kind)
		.map((update) => (update.sessionUpdate === kind && update.content.type === "text" ? update.content.text : ""))
		.join("");
}

function kinds(updates: readonly SessionUpdate[]): string[] {
	// Deltas arrive token-sized; collapse runs so the shape of the turn is what is asserted.
	return updates
		.map((update) => update.sessionUpdate)
		.filter((kind, index, all) => index === 0 || kind !== all[index - 1] || !kind.endsWith("_chunk"));
}

describe("ACP agent", () => {
	let counter = 0;
	let server: EngineServer | undefined;
	let registry: SessionRegistry | undefined;
	let connection: ClientConnection | undefined;
	const dirs: string[] = [];

	afterEach(async () => {
		connection?.close();
		connection = undefined;
		await registry?.closeAll();
		await server?.close();
		registry = undefined;
		server = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(
		options: {
			tokensPerSecond?: number;
			reasoning?: boolean;
			holdEvents?: boolean;
			/** Keep transcripts on disk, under the temporary agent directory. */
			persist?: boolean;
			prompts?: Record<string, string>;
		} = {},
	): Promise<{
		cwd: string;
		faux: FauxProviderHandle;
		engine: EngineClient;
		buffers: Map<string, string>;
		permissions: RequestPermissionRequest[];
		session: ActiveSession;
		decide(decision: Decision): void;
		/** With `holdEvents`: let the engine answer `/events` — with the stream, or with a 503. */
		releaseEvents(ok?: boolean): void;
	}> {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-acp-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-acp-agent-"));
		dirs.push(cwd, agentDir);
		const events = createEventBus();
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null, events });
		const faux = fauxProvider({
			provider: `faux-acp-${counter++}`,
			tokensPerSecond: options.tokensPerSecond,
			...(options.reasoning ? { models: [{ id: "faux-thinker", reasoning: true }] } : {}),
		});
		ctx.models.registerNativeProvider(faux.provider);
		for (const [promptName, body] of Object.entries(options.prompts ?? {})) {
			mkdirSync(join(agentDir, "prompts"), { recursive: true });
			writeFileSync(join(agentDir, "prompts", `${promptName}.md`), body);
		}
		registry = createSessionRegistry(ctx, {
			agentDir,
			sessionDir: options.persist ? undefined : null,
			defaultModel: faux.getModel(),
		});
		// An engine whose event stream is not up yet: the route hangs until released.
		const stream = eventsRoute(events, 50);
		const held = Promise.withResolvers<void>();
		const holdable: EngineRoute = {
			...stream,
			handle: (req, res, url) =>
				void held.promise.then(
					() => stream.handle(req, res, url),
					() => res.writeHead(503).end(),
				),
		};
		server = await startEngineServer({
			token: "t",
			routes: [options.holdEvents ? holdable : stream, modelsRoute(ctx), ...sessionRoutes(ctx, registry)],
		});
		const engine = createEngineClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "t", reconnectDelayMs: 10 });

		// The editor: buffers it owns, and a permission policy the test can change.
		const buffers = new Map<string, string>();
		const permissions: RequestPermissionRequest[] = [];
		let decision: Decision = () => "allow_once";
		const editor = client({ name: "test-editor" })
			.onRequest("fs/read_text_file", ({ params }) => {
				const content = buffers.get(params.path);
				if (content === undefined) throw RequestError.resourceNotFound(params.path);
				return { content };
			})
			.onRequest("fs/write_text_file", ({ params }) => {
				buffers.set(params.path, params.content);
				return {};
			})
			.onRequest("session/request_permission", ({ params }) => {
				permissions.push(params);
				return { outcome: { outcome: "selected", optionId: decision(params) } };
			});
		connection = editor.connect(createAcpAgent(engine, { name: "knightcode-test", version: "0.0.0" }));
		await connection.agent.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
		});
		const session = await connection.agent.buildSession(cwd).start();
		return {
			cwd,
			faux,
			engine,
			buffers,
			permissions,
			session,
			decide: (next) => {
				decision = next;
			},
			releaseEvents: (ok = true) => (ok ? held.resolve() : held.reject(new Error("refused"))),
		};
	}

	test("initialize and session/new advertise what Zed needs", async () => {
		const { faux, session } = await start();
		const init = await connection!.agent.request("initialize", { protocolVersion: PROTOCOL_VERSION });
		expect(init.protocolVersion).toBe(1);
		expect(init.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
		expect(init.agentCapabilities?.sessionCapabilities?.close).toBeDefined();
		expect(init.agentCapabilities?.loadSession).toBe(true);
		expect(init.agentCapabilities?.sessionCapabilities).toMatchObject({ resume: {}, list: {}, delete: {} });
		expect(init.agentInfo?.name).toBe("knightcode-test");

		const options = session.newSessionResponse.configOptions ?? [];
		const model = options.find((option) => option.id === "model");
		expect(model?.type === "select" ? model.currentValue : undefined).toBe(`${faux.provider.id}/${faux.getModel().id}`);
		expect(options.find((option) => option.id === "thinking")?.category).toBe("thought_level");
	});

	test("a turn streams text, edits through the editor with a reviewed diff, and ends", async () => {
		const { cwd, faux, buffers, permissions, session } = await start();
		const path = join(cwd, "a.txt");
		buffers.set(path, "hello world\n");
		writeFileSync(path, "hello world\n");
		// One assistant message carrying text and the call, as a real provider streams it.
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxText("Editing."),
					fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage([fauxText("Done.")]),
		]);

		const done = session.prompt("change world to there");
		const { updates, stopReason } = await collect(session);
		await done;

		expect(stopReason).toBe("end_turn");
		expect(textOf(updates, "agent_message_chunk")).toBe("Editing.Done.");
		expect(kinds(updates)).toEqual([
			"agent_message_chunk",
			"tool_call",
			"tool_call_update", // in progress
			"tool_call_update", // the diff, at write time
			"tool_call_update", // completed
			"agent_message_chunk",
			"usage_update",
		]);

		const [announced] = updates.filter((update) => update.sessionUpdate === "tool_call");
		expect(announced).toMatchObject({ title: "Edit a.txt", kind: "edit", status: "pending", locations: [{ path }] });

		expect(permissions).toHaveLength(1);
		expect(permissions[0].toolCall.toolCallId).toBe(
			announced.sessionUpdate === "tool_call" ? announced.toolCallId : "",
		);
		expect(permissions[0].toolCall.content).toEqual([
			{ type: "diff", path, oldText: "hello world\n", newText: "hello there\n" },
		]);
		expect(permissions[0].options.map((option) => option.kind)).toEqual(["allow_once", "allow_always", "reject_once"]);

		const diffed = updates.find(
			(update) =>
				update.sessionUpdate === "tool_call_update" && Array.isArray(update.content) && update.content.length > 0,
		);
		expect(diffed).toMatchObject({
			kind: "edit",
			content: [{ type: "diff", path, oldText: "hello world\n", newText: "hello there\n" }],
		});
		const completed = updates.filter((update) => update.sessionUpdate === "tool_call_update").at(-1);
		expect(completed).toMatchObject({ status: "completed" });
		expect(completed).not.toHaveProperty("content");

		expect(buffers.get(path)).toBe("hello there\n");
		expect(readFileSync(path, "utf-8")).toBe("hello world\n");
		expect(updates.at(-1)).toMatchObject({ sessionUpdate: "usage_update", size: faux.getModel().contextWindow });
	});

	test("a prompt waits for the event stream, whose events the engine does not replay", async () => {
		const { faux, session, releaseEvents } = await start({ holdEvents: true });
		faux.setResponses([fauxAssistantMessage([fauxText("Hi.")])]);

		const done = session.prompt("hello");
		// Nothing has reached the model: a turn ended now would end unheard.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(faux.getPendingResponseCount()).toBe(1);

		releaseEvents();
		const { updates, stopReason } = await collect(session);
		await done;
		expect(stopReason).toBe("end_turn");
		expect(textOf(updates, "agent_message_chunk")).toBe("Hi.");
	});

	test("a prompt fails, rather than waits forever, when the event stream cannot be opened", async () => {
		const { session, releaseEvents } = await start({ holdEvents: true });
		const done = session.prompt("hello");
		releaseEvents(false);
		await expect(done).rejects.toMatchObject({ data: { details: "engine event stream disconnected" } });
	});

	test("a rejected permission leaves the buffer alone and the call rejected", async () => {
		const { cwd, faux, buffers, session, decide } = await start();
		decide(() => "reject_once");
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "new.txt", content: "created" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Understood.")]),
		]);
		const done = session.prompt("create a file");
		const { updates, stopReason } = await collect(session);
		await done;
		expect(stopReason).toBe("end_turn");
		expect(buffers.has(join(cwd, "new.txt"))).toBe(false);
		const ended = updates.filter((update) => update.sessionUpdate === "tool_call_update").at(-1);
		expect(ended).not.toHaveProperty("status");
		expect(textOf(updates, "agent_message_chunk")).toBe("Understood.");
	});

	test("cancel answers cancelled and the session takes the next prompt", async () => {
		const { faux, session } = await start({ tokensPerSecond: 20 });
		faux.setResponses([fauxAssistantMessage([fauxText("d".repeat(400))])]);
		const first = session.prompt("slow");
		const firstChunk = await session.nextUpdate();
		expect(firstChunk.kind).toBe("session_update");
		await connection!.agent.notify("session/cancel", { sessionId: session.sessionId });
		expect((await first).stopReason).toBe("cancelled");
		// Drain whatever was in flight before the stop.
		for (;;) {
			const message = await session.nextUpdate();
			if (message.kind === "stop") break;
		}

		faux.setResponses([fauxAssistantMessage([fauxText("again")])]);
		const second = session.prompt("next");
		const { stopReason, updates } = await collect(session);
		await second;
		expect(stopReason).toBe("end_turn");
		expect(textOf(updates, "agent_message_chunk")).toBe("again");
	});

	test("a path the editor does not own is read from disk", async () => {
		const { cwd, faux, session } = await start();
		writeFileSync(join(cwd, "disk-only.txt"), "only on disk");
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "disk-only.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("read it")]),
		]);
		const done = session.prompt("read");
		const { updates } = await collect(session);
		await done;
		const completed = updates.filter((update) => update.sessionUpdate === "tool_call_update").at(-1);
		expect(completed).toMatchObject({
			status: "completed",
			content: [{ type: "content", content: { type: "text", text: "only on disk" } }],
		});
	});

	test("set_config_option changes the thinking level", async () => {
		// A reasoning model has more than one thinking level to choose from.
		const { session } = await start({ reasoning: true });
		const options = session.newSessionResponse.configOptions ?? [];
		const thinking = options.find((option) => option.id === "thinking");
		if (thinking?.type !== "select") throw new Error("thinking is not a select");
		// Thinking levels are a flat list, not groups.
		const values = (thinking.options as { value: string }[]).map((option) => option.value);
		const next = values.find((value) => value !== thinking.currentValue);
		expect(next).toBeDefined();
		const response = await connection!.agent.request("session/set_config_option", {
			sessionId: session.sessionId,
			configId: "thinking",
			value: next!,
		});
		const updated = response.configOptions.find((option) => option.id === "thinking");
		expect(updated?.type === "select" ? updated.currentValue : undefined).toBe(next);
	});

	test("closing the connection closes the sessions on the engine", async () => {
		await start();
		expect(registry!.size()).toBe(1);
		connection!.close();
		connection = undefined;
		await until(() => registry!.size() === 0);
	});

	/** The editor after a restart: a new connection to the same engine that records every update. */
	async function reconnect(engine: EngineClient): Promise<SessionNotification[]> {
		const notifications: SessionNotification[] = [];
		const editor = client({ name: "test-editor-restarted" }).onNotification("session/update", ({ params }) => {
			notifications.push(params);
		});
		connection = editor.connect(createAcpAgent(engine, { name: "knightcode-test", version: "0.0.0" }));
		await connection.agent.request("initialize", { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
		return notifications;
	}

	/** Run one turn to its end and close the editor, as quitting the IDE does. */
	async function talkThenQuit(session: ActiveSession, text: string): Promise<void> {
		const done = session.prompt(text);
		await collect(session);
		await done;
		connection!.close();
		await until(() => registry!.size() === 0);
	}

	test("a session loaded by a restarted editor replays its history and carries on", async () => {
		const { cwd, faux, engine, session } = await start({ persist: true });
		const sessionId = session.sessionId;
		faux.setResponses([fauxAssistantMessage([fauxText("Hi there.")])]);
		await talkThenQuit(session, "hello");

		const notifications = await reconnect(engine);
		await connection!.agent.request("session/load", { sessionId, cwd, mcpServers: [] });
		expect(notifications.every((notification) => notification.sessionId === sessionId)).toBe(true);
		const replay = notifications
			.map((notification) => notification.update)
			.filter((update) => update.sessionUpdate !== "available_commands_update");
		expect(replay.map((update) => update.sessionUpdate)).toEqual(["user_message_chunk", "agent_message_chunk"]);
		expect(replay[0]).toMatchObject({ content: { type: "text", text: "hello" } });
		expect(replay[1]).toMatchObject({ content: { type: "text", text: "Hi there." } });

		const before = notifications.length;
		faux.setResponses([fauxAssistantMessage([fauxText("Still here.")])]);
		const answer = await connection!.agent.request("session/prompt", {
			sessionId,
			prompt: [{ type: "text", text: "again" }],
		});
		expect(answer.stopReason).toBe("end_turn");
		const turn = notifications.slice(before).map((notification) => notification.update);
		expect(textOf(turn, "agent_message_chunk")).toBe("Still here.");
	});

	test("resume reopens without a replay, and list and delete manage saved sessions", async () => {
		const { cwd, faux, engine, session } = await start({ persist: true });
		const sessionId = session.sessionId;
		faux.setResponses([fauxAssistantMessage([fauxText("One.")])]);
		await talkThenQuit(session, "first message");

		const notifications = await reconnect(engine);
		const listed = await connection!.agent.request("session/list", { cwd });
		expect(listed.sessions).toEqual([expect.objectContaining({ sessionId, title: "first message" })]);

		await connection!.agent.request("session/resume", { sessionId, cwd });
		// Only the command list: a resume replays nothing.
		expect(
			notifications.filter((notification) => notification.update.sessionUpdate !== "available_commands_update"),
		).toEqual([]);
		expect(registry!.size()).toBe(1);

		await connection!.agent.request("session/delete", { sessionId });
		expect(registry!.size()).toBe(0);
		expect((await connection!.agent.request("session/list", { cwd })).sessions).toEqual([]);
		await expect(connection!.agent.request("session/load", { sessionId, cwd, mcpServers: [] })).rejects.toBeDefined();
	});

	test("a prompt to a session the engine lost reopens it from its transcript and goes through", async () => {
		const { faux, session } = await start({ persist: true });
		faux.setResponses([fauxAssistantMessage([fauxText("First.")])]);
		const first = session.prompt("one");
		await collect(session);
		await first;

		// As after an engine restart: the live session is gone, the transcript is not.
		await registry!.close(session.sessionId);
		expect(registry!.size()).toBe(0);

		faux.setResponses([fauxAssistantMessage([fauxText("Second.")])]);
		const second = session.prompt("two");
		const { updates, stopReason } = await collect(session);
		await second;
		expect(stopReason).toBe("end_turn");
		expect(textOf(updates, "agent_message_chunk")).toBe("Second.");
		expect(registry!.size()).toBe(1);
	});

	test("a new session tells the editor which slash commands it offers, after answering", async () => {
		const { cwd, engine } = await start({
			prompts: { review: "---\ndescription: Review the change\n---\nReview $@\n" },
		});
		connection!.close();
		const notifications = await reconnect(engine);
		const { sessionId } = await connection!.agent.request("session/new", { cwd, mcpServers: [] });
		await until(() =>
			notifications.some((notification) => notification.update.sessionUpdate === "available_commands_update"),
		);
		const [announced] = notifications.filter(
			(notification) => notification.update.sessionUpdate === "available_commands_update",
		);
		expect(announced.sessionId).toBe(sessionId);
		expect(announced.update).toMatchObject({
			availableCommands: expect.arrayContaining([
				expect.objectContaining({ name: "review", description: "Review the change", input: { hint: "arguments" } }),
			]),
		});
	});
});
