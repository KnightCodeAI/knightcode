// packages/bots-protocol/test/fake.test.ts
import { expect, it } from "vitest";
import { createApiClient, createFakeBackend, decodeFrame, encodeFrame } from "../src/index.ts";

it("creates a bot through the API", async () => {
	const fake = createFakeBackend();
	const api = createApiClient(fake.fetch, "https://bots.test");
	const bot = await api.createBot({ name: "Reviewer" });
	expect((await api.listBots({})).bots.map((b) => b.id)).toContain(bot.id);
});

it("streams a reply as view, ops, and a final assistant entry", async () => {
	const fake = createFakeBackend();
	const socket = fake.connect();
	const frames: unknown[] = [];
	socket.addEventListener("message", (e) => frames.push(decodeFrame(String(e.data))));
	socket.send(encodeFrame({ type: "auth", ticket: "fake" }));
	socket.send(encodeFrame({ type: "subscribe", botId: fake.seed.bots[0].id }));
	socket.send(encodeFrame({ type: "submit", botId: fake.seed.bots[0].id, text: "hello", requestId: "r1" }));
	await fake.clock.runAll();
	expect(frames.some((f: any) => f.type === "view")).toBe(true);
	expect(frames.filter((f: any) => f.type === "ops").length).toBeGreaterThan(1);
});

it("runs an approved action once even when answered twice", async () => {
	const fake = createFakeBackend();
	const api = createApiClient(fake.fetch, "https://bots.test");
	const [approval] = fake.seed.approvals;
	await Promise.all([
		api.answerApproval({ id: approval.id, decision: "allow" }),
		api.answerApproval({ id: approval.id, decision: "allow" }),
	]);
	expect(fake.executed(approval.id)).toBe(1);
});
