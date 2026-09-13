import { afterEach, describe, expect, test } from "vitest";
import { createEventBus, eventsRoute } from "../../src/engine/events.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

describe("event bus", () => {
	test("delivers to every subscriber and stops after unsubscribe", () => {
		const bus = createEventBus();
		const seen: string[] = [];
		const stop = bus.subscribe((event) => seen.push(event.type));
		bus.publish({ type: "models.changed" });
		expect(seen).toEqual(["models.changed"]);
		stop();
		bus.publish({ type: "models.changed" });
		expect(seen).toEqual(["models.changed"]);
		expect(bus.subscriberCount()).toBe(0);
	});

	test("one failing subscriber does not stop the others", () => {
		const bus = createEventBus();
		const seen: string[] = [];
		bus.subscribe(() => {
			throw new Error("boom");
		});
		bus.subscribe((event) => seen.push(event.type));
		bus.publish({ type: "models.changed" });
		expect(seen).toEqual(["models.changed"]);
	});

	test("a subscriber added during delivery does not receive the in-flight event", () => {
		const bus = createEventBus();
		const late: string[] = [];
		bus.subscribe(() => {
			bus.subscribe((event) => late.push(event.type));
		});
		bus.publish({ type: "models.changed" });
		expect(late).toEqual([]);
		bus.publish({ type: "models.changed" });
		expect(late).toEqual(["models.changed"]);
	});
});

describe("GET /events", () => {
	let server: EngineServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	test("streams published events as SSE and drops the subscriber on disconnect", async () => {
		const bus = createEventBus();
		server = await startEngineServer({ token: "t", routes: [eventsRoute(bus, 50)] });
		const controller = new AbortController();
		const res = await fetch(`http://127.0.0.1:${server.port}/events`, {
			headers: { authorization: "Bearer t" },
			signal: controller.signal,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");

		const body = res.body;
		expect(body).not.toBeNull();
		const reader = body!.getReader();
		const decoder = new TextDecoder();

		// The subscriber is installed before the response resolves, but publish
		// from this side of the socket still needs the handler to have run.
		while (bus.subscriberCount() === 0) await new Promise((resolve) => setTimeout(resolve, 5));
		bus.publish({ type: "account.changed", providerId: "anthropic", authenticated: true });

		let buffer = "";
		while (!buffer.includes("account.changed")) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
		expect(buffer).toContain('"providerId":"anthropic"');

		await reader.cancel();
		controller.abort();
		const deadline = Date.now() + 2000;
		while (bus.subscriberCount() > 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(bus.subscriberCount()).toBe(0);
	});

	test("sends a heartbeat comment on the configured interval", async () => {
		const bus = createEventBus();
		server = await startEngineServer({ token: "t", routes: [eventsRoute(bus, 30)] });
		const controller = new AbortController();
		const res = await fetch(`http://127.0.0.1:${server.port}/events`, {
			headers: { authorization: "Bearer t" },
			signal: controller.signal,
		});
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();

		let buffer = "";
		while (!buffer.includes(": heartbeat")) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
		expect(buffer).toContain(": heartbeat");

		await reader.cancel();
		controller.abort();
	});
});
