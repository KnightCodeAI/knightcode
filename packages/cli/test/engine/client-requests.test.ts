import { describe, expect, test } from "vitest";
import { ClientRequestAborted, createClientRequests } from "../../src/engine/client-requests.ts";
import { createEventBus, type EngineEvent } from "../../src/engine/events.ts";

function published(seen: EngineEvent[]): Extract<EngineEvent, { type: "session.request" }>[] {
	return seen.filter(
		(event): event is Extract<EngineEvent, { type: "session.request" }> => event.type === "session.request",
	);
}

describe("client requests", () => {
	test("publishes the request and resolves with the reply", async () => {
		const bus = createEventBus();
		const seen: EngineEvent[] = [];
		bus.subscribe((event) => seen.push(event));
		const requests = createClientRequests(bus);

		const pending = requests.ask("s1", { kind: "fs.read", path: "/a.txt" });
		const [event] = published(seen);
		expect(event.sessionId).toBe("s1");
		expect(event.request).toEqual({ kind: "fs.read", path: "/a.txt" });
		expect(requests.size()).toBe(1);

		expect(requests.reply("s1", event.requestId, { kind: "fs.read", content: "hello" })).toBe(true);
		await expect(pending).resolves.toEqual({ kind: "fs.read", content: "hello" });
		expect(requests.size()).toBe(0);
	});

	test("refuses a reply to an unknown, foreign or already answered request", async () => {
		const bus = createEventBus();
		const seen: EngineEvent[] = [];
		bus.subscribe((event) => seen.push(event));
		const requests = createClientRequests(bus);
		expect(requests.reply("s1", "nope", { kind: "fs.write" })).toBe(false);

		const pending = requests.ask("s1", { kind: "fs.write", path: "/a.txt", content: "x" });
		const [event] = published(seen);
		// Another session cannot answer it, and a refused reply leaves it parked.
		expect(requests.reply("s2", event.requestId, { kind: "fs.write" })).toBe(false);
		expect(requests.size()).toBe(1);
		expect(requests.reply("s1", event.requestId, { kind: "fs.write" })).toBe(true);
		expect(requests.reply("s1", event.requestId, { kind: "fs.write" })).toBe(false);
		await pending;
	});

	test("an aborted signal rejects the parked request", async () => {
		const requests = createClientRequests(createEventBus());
		const controller = new AbortController();
		const pending = requests.ask(
			"s1",
			{ kind: "permission", toolCallId: "t", toolName: "bash", input: {} },
			controller.signal,
		);
		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(ClientRequestAborted);
		expect(requests.size()).toBe(0);
	});

	test("an already aborted signal never parks", async () => {
		const requests = createClientRequests(createEventBus());
		const controller = new AbortController();
		controller.abort();
		await expect(requests.ask("s1", { kind: "fs.read", path: "/a.txt" }, controller.signal)).rejects.toBeInstanceOf(
			ClientRequestAborted,
		);
		expect(requests.size()).toBe(0);
	});

	test("abortAll rejects only that session's requests", async () => {
		const requests = createClientRequests(createEventBus());
		const mine = requests.ask("s1", { kind: "fs.read", path: "/a.txt" });
		const theirs = requests.ask("s2", { kind: "fs.read", path: "/b.txt" });
		requests.abortAll("s1", "closed");
		await expect(mine).rejects.toThrow("closed");
		expect(requests.size()).toBe(1);
		requests.abortAll("s2", "closed");
		await expect(theirs).rejects.toBeInstanceOf(ClientRequestAborted);
	});
});
