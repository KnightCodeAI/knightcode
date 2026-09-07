import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
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
		await settle();

		const viewer = await connect("room-b", "viewer", "acct-1");
		const seen: number[] = [];
		viewer.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data)).seq));
		viewer.send(encodeFrame({ v: 1, type: "hello", since: 2 }));
		await settle();
		expect(seen).toContain(3);
		expect(seen).not.toContain(2);
	});

	it("falls back to a full replay when the resume point was truncated away", async () => {
		const host = await connect("room-c", "host", "acct-1");
		host.send(encodeFrame({ v: 1, type: "entries", entries: [{ id: "old" }] }));
		host.send(encodeFrame({ v: 1, type: "snapshot", cwd: "/tmp", leafId: null, entries: [{ id: "fresh" }] }));
		await settle();

		const viewer = await connect("room-c", "viewer", "acct-1");
		const seen: string[] = [];
		viewer.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data)).type));
		viewer.send(encodeFrame({ v: 1, type: "hello", since: 1 }));
		await settle();
		expect(seen[0]).toBe("snapshot");
	});

	it("survives every viewer leaving and keeps the host attached", async () => {
		const host = await connect("room-d", "host", "acct-1");
		const viewer = await connect("room-d", "viewer", "acct-1");
		viewer.close();
		await settle();
		await runInDurableObject(stub("room-d"), (instance: RemoteRoom) => {
			expect(instance.hostCount()).toBe(1);
		});
		expect(host.readyState).toBe(WebSocket.READY_STATE_OPEN);
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
		await settle();

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
		await env.DB.prepare(
			"INSERT INTO rooms (id, account_id, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, 'live')",
		)
			.bind("room-g", account.id, Date.now(), Date.now())
			.run();

		const host = await connect("room-g", "host", account.id);
		host.close();
		await settle();
		const offline = await env.DB.prepare("SELECT status FROM rooms WHERE id = ?").bind("room-g").first<{
			status: string;
		}>();
		expect(offline?.status).toBe("offline");
	});

	it("deletes the D1 row keyed by the room id, not the durable object id, when the TTL alarm fires", async () => {
		const account = await upsertAccount(env.DB, "github", "10", "owner", null);
		await env.DB.prepare(
			"INSERT INTO rooms (id, account_id, created_at, last_seen_at, status) VALUES (?, ?, ?, ?, 'live')",
		)
			.bind("room-h", account.id, Date.now(), Date.now())
			.run();

		const host = await connect("room-h", "host", account.id);
		host.close();
		await settle();
		await runInDurableObject(stub("room-h"), async (instance: RemoteRoom) => {
			await instance.alarm();
		});

		const row = await env.DB.prepare("SELECT id FROM rooms WHERE id = ?").bind("room-h").first();
		expect(row).toBeNull();
	});
});
