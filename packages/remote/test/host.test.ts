import { describe, expect, test, vi } from "vitest";
import { RelayHost, type RelayWebSocket } from "../src/host.ts";
import { encodeFrame } from "../src/protocol.ts";

class FakeSocket implements RelayWebSocket {
	readyState = 1;
	readonly OPEN = 1;
	bufferedAmount = 0;
	sent: string[] = [];
	#listeners = new Map<string, Array<(event: unknown) => void>>();

	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}
	addEventListener(type: string, listener: (event: never) => void): void {
		const existing = this.#listeners.get(type) ?? [];
		existing.push(listener as (event: unknown) => void);
		this.#listeners.set(type, existing);
	}
	removeEventListener(): void {}
	emit(type: string, event: unknown): void {
		for (const listener of this.#listeners.get(type) ?? []) listener(event);
	}
}

function harness() {
	const socket = new FakeSocket();
	const prompts: string[] = [];
	const aborts: number[] = [];
	const statuses: string[] = [];
	const rooms: string[] = [];
	const host = new RelayHost({
		origin: "https://remote.knightcode.dev",
		token: "t",
		cwd: "/repo",
		onPrompt: (text) => prompts.push(text),
		onAbort: () => aborts.push(1),
		onResnapshot: () => {},
		onStatus: (status) => statuses.push(status.state),
		onRoom: (id) => rooms.push(id),
		socketFactory: () => socket,
	});
	return { host, socket, prompts, aborts, statuses, rooms };
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

	test("never exposes a way to end the session", () => {
		const { host } = harness();
		expect(Object.getOwnPropertyNames(Object.getPrototypeOf(host))).not.toContain("shutdown");
	});
});
