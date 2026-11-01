import { type ConversationView, createFakeBackend, type WebSocketLike } from "@knightcode/bots-protocol";
import { describe, expect, it } from "vitest";
import { ThreadSocket } from "../src/state/socket.ts";

const lastText = (view: ConversationView | undefined) => {
	const last = view?.entries.at(-1);
	return last?.kind === "message" ? last.text : undefined;
};

describe("ThreadSocket", () => {
	it("keeps a watched thread's view current through a streamed reply", async () => {
		const fake = createFakeBackend();
		const socket = new ThreadSocket(
			() => fake.connect(),
			async () => "ticket",
		);
		let view: ConversationView | undefined;
		socket.watch({ botId: "inbox" }, (next) => {
			view = next;
		});
		await fake.clock.runAll();
		const before = view?.entries.length ?? 0;
		socket.submit({ botId: "inbox" }, "hello");
		await fake.clock.runAll();
		expect(view?.entries.length).toBe(before + 2);
		expect(lastText(view)).toBe(fake.state.replies.inbox);
		expect(view?.running).toBe(false);
	});

	it("resumes after a dropped connection with no gap and no duplicate text", async () => {
		const fake = createFakeBackend();
		const sockets: WebSocketLike[] = [];
		const socket = new ThreadSocket(
			() => {
				const s = fake.connect();
				sockets.push(s);
				return s;
			},
			async () => "ticket",
		);
		let view: ConversationView | undefined;
		socket.watch({ botId: "inbox" }, (next) => {
			view = next;
		});
		await fake.clock.runAll();
		socket.submit({ botId: "inbox" }, "hello");
		await fake.clock.advance(120);
		sockets[0]!.close();
		await fake.clock.runAll();
		await new Promise((resolve) => setTimeout(resolve, 300));
		await fake.clock.runAll();
		expect(sockets.length).toBe(2);
		expect(lastText(view)).toBe(fake.state.replies.inbox);
	});
});
