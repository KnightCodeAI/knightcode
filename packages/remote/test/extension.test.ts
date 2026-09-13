import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@knightcodeai/cli";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ENV_CONFIG_DIR, ENV_RELAY } from "../src/auth.ts";
import { remoteCommands, remoteExtension } from "../src/extension.ts";
import { FakeSocket } from "./fake-socket.ts";

describe("remote commands", () => {
	test("offers every dispatchable command except remote itself", () => {
		const offered = remoteCommands([
			{ name: "remote", description: "Publish this session" },
			{ name: "review", description: "Review the diff" },
			{ name: "skill:deploy" },
		]);
		expect(offered).toEqual([{ name: "review", description: "Review the diff" }, { name: "skill:deploy" }]);
	});

	test("a remote prompt takes the same expansion path as terminal input", () => {
		// Without expandPromptTemplates a "/review" typed on the phone would reach the model as
		// literal text. The option is what makes the command list in the browser mean anything.
		const source = readFileSync(join(import.meta.dirname, "..", "src", "extension.ts"), "utf8");
		expect(source).toMatch(/sendUserMessage\(text, \{ deliverAs: "followUp", expandPromptTemplates: true \}\)/);
	});
});

type Handler = (event: unknown, ctx: unknown) => unknown;

/**
 * Runs the real extension against a fake ExtensionAPI and a fake relay socket. The token
 * file and relay origin come from the env overrides auth.ts exists for.
 */
function harness() {
	const handlers = new Map<string, Handler[]>();
	let command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> } | undefined;
	const sockets: FakeSocket[] = [];
	const notices: string[] = [];
	const statuses: Array<string | undefined> = [];
	const entries: unknown[] = [
		{ type: "message", id: "e1", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
	];
	const state = { idle: true };

	const api = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand(_name: string, definition: typeof command) {
			command = definition;
		},
		getCommands: () => [{ name: "remote" }, { name: "review", description: "Review the diff" }],
		sendUserMessage: vi.fn(),
	};
	const ctx = {
		mode: "tui",
		cwd: "/repo",
		model: { id: "anthropic/claude" },
		sessionManager: { getEntries: () => entries, getLeafId: () => "e1", getSessionName: () => "my session" },
		isIdle: () => state.idle,
		getContextUsage: () => undefined,
		abort: vi.fn(),
		ui: {
			notify: (message: string) => notices.push(message),
			setStatus: (_key: string, text: string | undefined) => statuses.push(text),
			theme: { fg: (_colour: string, text: string) => text },
		},
	} as unknown as ExtensionCommandContext;

	remoteExtension(api as unknown as ExtensionAPI, {
		socketFactory: () => {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
	});

	const emit = async (event: string, payload: Record<string, unknown> = {}): Promise<void> => {
		for (const handler of handlers.get(event) ?? []) await handler({ type: event, ...payload }, ctx);
	};
	const run = (args = ""): Promise<void> => {
		if (!command) throw new Error("remote command was not registered");
		return command.handler(args, ctx);
	};
	const roomIn = (notice: string): string | undefined => /\/r\/([0-9A-F]{32})/.exec(notice)?.[1];
	return { run, emit, sockets, notices, statuses, state, entries, roomIn };
}

describe("remote extension", () => {
	let configDir: string;

	beforeEach(async () => {
		configDir = await mkdtemp(join(tmpdir(), "kc-remote-"));
		await writeFile(join(configDir, "remote-auth.json"), JSON.stringify({ token: "t" }));
		vi.stubEnv(ENV_CONFIG_DIR, configDir);
		vi.stubEnv(ENV_RELAY, "http://relay.test");
		vi.stubEnv("KNIGHTCODE_OFFLINE", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test("publishes the transcript and the command list once the socket is open, not before", async () => {
		const { run, sockets } = harness();
		await run();
		const socket = sockets[0];
		if (!socket) throw new Error("no socket was opened");
		expect(socket.frames().filter((frame) => frame.type === "snapshot")).toHaveLength(0);

		socket.emit("open", {});
		const snapshot = socket.frames().find((frame) => frame.type === "snapshot");
		expect(snapshot).toMatchObject({ commands: [{ name: "review", description: "Review the diff" }] });
		expect((snapshot?.entries as unknown[]).length).toBe(1);
	});

	test("bare /remote toggles: off keeps the link, on again reuses the same room", async () => {
		const { run, sockets, notices, statuses, roomIn } = harness();
		await run();
		const first = roomIn(notices.at(-1) ?? "");
		expect(first).toMatch(/^[0-9A-F]{32}$/);
		sockets[0]?.emit("open", {});

		await run();
		expect(sockets[0]?.readyState).toBe(3);
		expect(statuses.at(-1)).toBeUndefined();
		expect(notices.at(-1)).toMatch(/paused/i);

		await run();
		expect(sockets).toHaveLength(2);
		expect(roomIn(notices.at(-1) ?? "")).toBe(first);
	});

	test("reports idle only once the agent has settled, not at agent_end", async () => {
		// The CLI emits agent_end before it clears its run flag, so isIdle() is still false
		// there. Publishing on agent_settled is what lets "Working" clear on the phone.
		const { run, emit, sockets, state } = harness();
		await run();
		sockets[0]?.emit("open", {});

		state.idle = false;
		await emit("agent_start");
		await emit("agent_end");
		state.idle = true;
		await emit("agent_settled");

		const statusFrames = sockets[0]?.frames().filter((frame) => frame.type === "status") ?? [];
		expect(statusFrames.at(-1)).toMatchObject({ streaming: false });
	});

	test("publishes the message that just ended, which the CLI appends only after message_end handlers return", async () => {
		const { run, emit, sockets, entries } = harness();
		await run();
		sockets[0]?.emit("open", {});

		// The CLI's order: every handler runs, then the entry is appended.
		await emit("message_end");
		entries.push({ type: "message", id: "e2", message: { role: "user", content: [{ type: "text", text: "x=2" }] } });
		await new Promise((resolve) => setTimeout(resolve, 0));

		const published = sockets[0]?.frames().filter((frame) => frame.type === "entries") ?? [];
		expect(published.flatMap((frame) => frame.entries as Array<{ id: string }>).map((entry) => entry.id)).toEqual([
			"e2",
		]);
	});

	test("streams thinking before the reply has any text", async () => {
		const { run, emit, sockets } = harness();
		await run();
		const socket = sockets[0];
		if (!socket) throw new Error("no socket was opened");
		socket.emit("open", {});
		socket.emit("message", { data: JSON.stringify({ v: 1, type: "viewer", count: 1 }) });

		await emit("message_update", {
			message: { role: "assistant", content: [{ type: "thinking", thinking: "weighing it" }] },
		});

		expect(socket.frames().filter((frame) => frame.type === "stream")).toEqual([
			expect.objectContaining({ content: "", thinking: "weighing it" }),
		]);
	});
});
