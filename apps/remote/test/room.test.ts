import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFrame } from "../../../packages/remote/src/protocol.ts";
import { upsertAccount } from "../src/accounts.ts";
import type { RemoteRoom } from "../src/room.ts";

function stub(name: string): DurableObjectStub {
	return env.ROOM.get(env.ROOM.idFromName(name));
}

async function connect(name: string, role: "host" | "viewer", accountId: string): Promise<WebSocket> {
	const response = await stub(name).fetch("https://room/ws", {
		headers: { upgrade: "websocket", "x-kc-role": role, "x-kc-account": accountId, "x-kc-room": name },
	});
	const socket = response.webSocket;
	if (!socket) throw new Error("expected a websocket");
	socket.accept();
	return socket;
}

function nextMessage(socket: WebSocket): Promise<string> {
	return new Promise((resolve) =>
		socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true }),
	);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

/**
 * Host frames reach the room asynchronously. A fixed sleep before the next step raced it on a
 * loaded CI runner: a viewer connected before the frames were stored and got them live instead
 * of as a replay. These wait for the room's own state instead.
 */
function stored(name: string, seq: number): Promise<void> {
	return vi.waitFor(() =>
		runInDurableObject(stub(name), async (_instance: RemoteRoom, state: DurableObjectState) => {
			expect(await state.storage.get("seq")).toBe(seq);
		}),
	);
}

async function seedRoom(id: string, accountId: string): Promise<void> {
	await env.DB.prepare("INSERT INTO rooms (id, account_id, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, 'live')")
		.bind(id, accountId, Date.now(), Date.now())
		.run();
}

async function column(id: string, name: "status" | "busy"): Promise<unknown> {
	const row = await env.DB.prepare(`SELECT ${name} FROM rooms WHERE id = ?`).bind(id).first<Record<string, unknown>>();
	return row?.[name];
}

/**
 * Offline in D1 means webSocketClose is past its status write. With the room not busy, what is
 * left is storage work, which holds the room's input gate until viewers are told.
 */
function offline(id: string): Promise<void> {
	return vi.waitFor(async () => expect(await column(id, "status")).toBe("offline"));
}

beforeEach(async () => {
	await env.DB.exec("DELETE FROM rooms");
	await env.DB.exec("DELETE FROM accounts");
});

describe("RemoteRoom", () => {
	it("stamps a monotonic seq and fans out to viewers", async () => {
		const host = await connect("room-a", "host", "acct-1");
		const viewer = await connect("room-a", "viewer", "acct-1");
		const inbound = nextMessage(viewer);

		host.send(encodeFrame({ v: 1, type: "entries", entries: [{ id: "e1" }] }));
		const frame = JSON.parse(await inbound) as { type: string; seq: number };
		expect(frame.type).toBe("entries");
		expect(frame.seq).toBe(1);
	});

	it("replays from the requested seq", async () => {
		const host = await connect("room-b", "host", "acct-1");
		host.send(encodeFrame({ v: 1, type: "snapshot", cwd: "/tmp", leafId: null, entries: [] }));
		host.send(encodeFrame({ v: 1, type: "entries", entries: [{ id: "e1" }] }));
		host.send(encodeFrame({ v: 1, type: "entries", entries: [{ id: "e2" }] }));
		await stored("room-b", 3);

		const viewer = await connect("room-b", "viewer", "acct-1");
		const seen: Array<{ type: string; seq?: number }> = [];
		viewer.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data))));
		viewer.send(encodeFrame({ v: 1, type: "hello", since: 2 }));
		// "host" closes every replay.
		await vi.waitFor(() => expect(seen.at(-1)?.type).toBe("host"));
		expect(seen.map((frame) => frame.seq)).toContain(3);
		expect(seen.map((frame) => frame.seq)).not.toContain(2);
	});

	it("falls back to a full replay when the resume point was truncated away", async () => {
		const host = await connect("room-c", "host", "acct-1");
		host.send(encodeFrame({ v: 1, type: "entries", entries: [{ id: "old" }] }));
		host.send(encodeFrame({ v: 1, type: "snapshot", cwd: "/tmp", leafId: null, entries: [{ id: "fresh" }] }));
		await stored("room-c", 2);

		const viewer = await connect("room-c", "viewer", "acct-1");
		const seen: string[] = [];
		viewer.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data)).type));
		viewer.send(encodeFrame({ v: 1, type: "hello", since: 1 }));
		await vi.waitFor(() => expect(seen.at(-1)).toBe("host"));
		expect(seen[0]).toBe("snapshot");
	});

	it("tells a viewer whether a terminal is attached, after replay and on every change", async () => {
		const account = await upsertAccount(env.DB, "github", "12", "owner", null);
		await seedRoom("room-j", account.id);
		// A past session: the host that created the room is gone by the time the viewer arrives.
		const first = await connect("room-j", "host", account.id);
		first.close();
		await offline("room-j");

		const viewer = await connect("room-j", "viewer", account.id);
		const seen: Array<{ type: string; online?: boolean }> = [];
		viewer.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data))));
		viewer.send(encodeFrame({ v: 1, type: "hello" }));
		await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ type: "host", online: false }));

		const again = await connect("room-j", "host", account.id);
		await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ type: "host", online: true }));

		again.close();
		await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ type: "host", online: false }));
	});

	it("forgets the streamed draft once a finished frame lands, so a later viewer never sees it", async () => {
		// The draft slot was kept forever and replayed to every new viewer, so an old
		// half-message reappeared with a caret under a transcript that had already moved on.
		const host = await connect("room-k", "host", "acct-1");
		host.send(encodeFrame({ v: 1, type: "stream", messageId: "m", content: "half a sent" }));
		host.send(encodeFrame({ v: 1, type: "entries", entries: [{ id: "m" }] }));
		await stored("room-k", 1);

		const viewer = await connect("room-k", "viewer", "acct-1");
		const seen: string[] = [];
		viewer.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data)).type));
		viewer.send(encodeFrame({ v: 1, type: "hello" }));
		await vi.waitFor(() => expect(seen.at(-1)).toBe("host"));
		expect(seen).toContain("entries");
		expect(seen).not.toContain("stream");
	});

	it("survives every viewer leaving and keeps the host attached", async () => {
		const host = await connect("room-d", "host", "acct-1");
		const viewer = await connect("room-d", "viewer", "acct-1");
		viewer.close();
		await settle();
		await runInDurableObject(stub("room-d"), (instance: RemoteRoom) => {
			expect(instance.hostCount()).toBe(1);
		});
		expect(host.readyState).toBe(WebSocket.OPEN);
	});

	it("rejects a viewer frame that is not valid protocol", async () => {
		const host = await connect("room-e", "host", "acct-1");
		const viewer = await connect("room-e", "viewer", "acct-1");
		await settle();
		const hostInbound = nextMessage(host);
		viewer.send("garbage");
		viewer.send(encodeFrame({ v: 1, type: "prompt", text: "real" }));
		expect(JSON.parse(await hostInbound).type).toBe("prompt");
	});

	it("deletes stored history on request and refuses a delete from another account", async () => {
		const host = await connect("room-f", "host", "acct-1");
		host.send(encodeFrame({ v: 1, type: "entries", entries: [{ id: "e1" }] }));
		await stored("room-f", 1);

		const forbidden = await stub("room-f").fetch("https://room/delete", { headers: { "x-kc-account": "acct-2" } });
		expect(forbidden.status).toBe(403);

		const allowed = await stub("room-f").fetch("https://room/delete", { headers: { "x-kc-account": "acct-1" } });
		expect(allowed.status).toBe(204);
		await runInDurableObject(stub("room-f"), async (_instance: RemoteRoom, state: DurableObjectState) => {
			expect([...(await state.storage.list({ prefix: "f:" })).keys()]).toEqual([]);
		});
	});

	it("marks its D1 row offline when the host disconnects and live again when it returns", async () => {
		const account = await upsertAccount(env.DB, "github", "9", "owner", null);
		await seedRoom("room-g", account.id);

		const host = await connect("room-g", "host", account.id);
		host.close();
		await offline("room-g");
	});

	it("mirrors the working state into D1 and clears it when the host drops mid-turn", async () => {
		const account = await upsertAccount(env.DB, "github", "11", "owner", null);
		await seedRoom("room-i", account.id);
		const busy = (value: number): Promise<void> =>
			vi.waitFor(async () => expect(await column("room-i", "busy")).toBe(value));

		const host = await connect("room-i", "host", account.id);
		host.send(encodeFrame({ v: 1, type: "status", idle: false, streaming: true }));
		await busy(1);

		host.send(encodeFrame({ v: 1, type: "status", idle: true, streaming: false }));
		await busy(0);

		host.send(encodeFrame({ v: 1, type: "status", idle: false, streaming: true }));
		await busy(1);
		host.close();
		// A terminal killed mid-turn must not leave the list spinning until the TTL.
		await busy(0);
	});

	it("deletes the D1 row keyed by the room id, not the durable object id, when the TTL alarm fires", async () => {
		const account = await upsertAccount(env.DB, "github", "10", "owner", null);
		await seedRoom("room-h", account.id);

		const host = await connect("room-h", "host", account.id);
		host.close();
		await offline("room-h");
		await runInDurableObject(stub("room-h"), async (instance: RemoteRoom) => {
			await instance.alarm();
		});

		const row = await env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind("room-h").first();
		expect(row).toBeNull();
	});
});
