import { describe, expect, it } from "vitest";
import { AssistantMessageEventStream, EventStream } from "../src/utils/event-stream.ts";

describe("EventStream termination", () => {
	it("rejects result() when the source ends without a terminal event", async () => {
		const stream = new AssistantMessageEventStream();
		stream.push({ type: "start", partial: {} as never });
		// A truncated SSE response reaches EOF with no `done`/`error` event; before this settled,
		// awaiting result() hung forever.
		stream.end();

		await expect(stream.result()).rejects.toThrow("Stream ended without a result");
	});

	it("keeps the terminal event's result when end() follows it", async () => {
		const stream = new AssistantMessageEventStream();
		const message = { role: "assistant", stopReason: "stop" } as never;
		stream.push({ type: "done", reason: "stop", message });
		stream.end();

		await expect(stream.result()).resolves.toBe(message);
	});

	it("rejects result() when extractResult throws for the terminal event", async () => {
		const stream = new EventStream<{ done: boolean }, string>(
			(event) => event.done,
			() => {
				throw new Error("bad terminal event");
			},
		);
		// push() marks the result settled before extracting, so a throw here left end() unable to
		// reject and awaiting result() hung forever.
		expect(() => stream.push({ done: true })).not.toThrow();
		stream.end();

		await expect(stream.result()).rejects.toThrow("bad terminal event");
	});
});
