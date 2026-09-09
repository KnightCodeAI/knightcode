import { describe, expect, test, vi } from "vitest";
import { RelayHost } from "../src/host.ts";
import { encodeFrame } from "../src/protocol.ts";
import { FakeSocket } from "./fake-socket.ts";

function harness() {
	// A fresh socket per connect, as undici gives the real host; `socket` is the first one.
	const sockets: FakeSocket[] = [new FakeSocket()];
	const socket = sockets[0] as FakeSocket;
	const prompts: string[] = [];
	const aborts: number[] = [];
	const statuses: string[] = [];
	const rooms: string[] = [];
	const opens: number[] = [];
	const host = new RelayHost({
		origin: "https://remote.knightcode.dev",
		token: "t",
		cwd: "/repo",
		onPrompt: (text) => prompts.push(text),
		onAbort: () => aborts.push(1),
		onResnapshot: () => {},
		onStatus: (status) => statuses.push(status.state),
		onRoom: (id) => rooms.push(id),
		onOpen: () => opens.push(1),
		socketFactory: () => {
			const next = sockets.length === 1 && socket.readyState === 1 ? socket : new FakeSocket();
			if (next !== socket) sockets.push(next);
			return next;
		},
	});
	return { host, socket, sockets, prompts, aborts, statuses, rooms, opens };
}

describe("relay host", () => {
	test("delivers viewer prompts and aborts to their callbacks", async () => {
		const { host, socket, prompts, aborts } = harness();
		host.start();
		socket.emit("open", {});
		socket.emit("message", { data: encodeFrame({ v: 1, type: "prompt", text: "hi" }) });
		socket.emit("message", { data: encodeFrame({ v: 1, type: "abort" }) });
		expect(prompts).toEqual(["hi"]);
		expect(aborts).toHaveLength(1);
		await host.close("done");
	});

	test("ignores frames that fail validation", async () => {
		const { host, socket, prompts } = harness();
		host.start();
		socket.emit("open", {});
		socket.emit("message", { data: "garbage" });
		socket.emit("message", { data: encodeFrame({ v: 1, type: "prompt", text: "real" }) });
		expect(prompts).toEqual(["real"]);
		await host.close("done");
	});

	test("reports retrying rather than terminating when the socket drops", async () => {
		vi.useFakeTimers();
		const { host, socket, statuses } = harness();
		host.start();
		socket.emit("open", {});
		socket.emit("close", { code: 1006, reason: "network" });
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses).toContain("retrying");
		await host.close("done");
		vi.useRealTimers();
	});

	test("reports the room id before any socket opens, so the link can be printed at once", () => {
		const { host, rooms } = harness();
		expect(rooms).toHaveLength(1);
		expect(rooms[0]).toMatch(/^[0-9A-F]{32}$/);
		expect(host.roomId).toBe(rooms[0]);
	});

	test("tracks the viewer count the relay reports", async () => {
		const { host, socket } = harness();
		host.start();
		socket.emit("open", {});
		socket.emit("message", { data: JSON.stringify({ v: 1, type: "viewer", count: 3 }) });
		expect(host.viewers).toBe(3);
		await host.close("done");
	});

	test("reports each socket open, but not viewer-count updates, so the caller can re-snapshot", async () => {
		// The first snapshot used to be sent before the socket existed and was dropped on the
		// floor; the viewer then never saw earlier chat or the command list.
		vi.useFakeTimers();
		const { host, socket, sockets, opens } = harness();
		host.start();
		expect(opens).toHaveLength(0);
		socket.emit("open", {});
		expect(opens).toHaveLength(1);
		socket.emit("message", { data: JSON.stringify({ v: 1, type: "viewer", count: 2 }) });
		expect(opens).toHaveLength(1);

		socket.close();
		await vi.advanceTimersByTimeAsync(1_000);
		sockets[1]?.emit("open", {});
		expect(opens).toHaveLength(2);
		await host.close("done");
		vi.useRealTimers();
	});

	test("never exposes a way to end the session", () => {
		const { host } = harness();
		expect(Object.getOwnPropertyNames(Object.getPrototypeOf(host))).not.toContain("shutdown");
	});
});
