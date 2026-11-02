// apps/bots/test/api.test.ts: the contract's routes and the UI's one socket, end to end through the Worker.
import { createApiClient, decodeFrame, encodeFrame, type ServerFrame } from "@knightcode/bots-protocol";
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import { createAccount } from "../src/auth/accounts.ts";
import { issueSession, SESSION_COOKIE } from "../src/auth/session.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { fakeModels } from "./fake-model.ts";

const ORIGIN = "https://bots.knightcode.dev";
let cookie = "";
beforeAll(async () => {
	const account = await createAccount(env.DB, { email: `${crypto.randomUUID()}@example.com`, name: "Ada" });
	cookie = `${SESSION_COOKIE}=${await issueSession(env, account.accountId)}`;
});
afterEach(() => setModelsFactory(undefined));

const api = () =>
	createApiClient((input, init) => SELF.fetch(input as string, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), cookie, origin: ORIGIN } }), ORIGIN);

it("creates a bot through the API and lists it with the account's sidebar", async () => {
	const client = api();
	await expect(client.createBot({ name: "Scout" })).rejects.toThrow(/model_required|choose a model/);
	await client.updateAccount({ defaultModel: { provider: "fake", modelId: "fake-model" } });
	const bot = await client.createBot({ name: "Scout", purpose: "Finds things" });
	expect(bot).toMatchObject({ name: "Scout", purpose: "Finds things", model: { provider: "fake", modelId: "fake-model" }, main: true, archived: false });
	await client.updateBot({ botId: bot.id, pinned: true, instructions: "Be brief." });
	const { bots } = await client.listBots({});
	expect(bots.find((candidate) => candidate.id === bot.id)).toMatchObject({ pinned: true, instructions: "Be brief.", instructionsVersion: 2 });
	expect((await client.listInstructionVersions({ botId: bot.id })).versions.map((version) => version.text)).toEqual(["", "Be brief."]);
	await client.archiveBot({ botId: bot.id });
	expect((await client.listBots({ archived: true })).bots.map((candidate) => candidate.id)).toContain(bot.id);
});

it("streams a reply over the UI's one socket, through the account's hub", async () => {
	const models = fakeModels([{ text: "Hello from Scout." }]);
	setModelsFactory(() => models);
	const client = api();
	await client.updateAccount({ defaultModel: { provider: "fake", modelId: "fake-model" } });
	const bot = await client.createBot({ name: "Echo" });
	const { ticket } = await client.issueTicket({ scope: "socket" });
	const response = await SELF.fetch(`${ORIGIN}/api/socket`, { headers: { upgrade: "websocket", cookie } });
	const socket = response.webSocket!;
	socket.accept();
	const frames: ServerFrame[] = [];
	socket.addEventListener("message", (event) => frames.push(decodeFrame(String(event.data)) as ServerFrame));
	socket.send(encodeFrame({ type: "auth", ticket }));
	socket.send(encodeFrame({ type: "subscribe", botId: bot.id }));
	socket.send(encodeFrame({ type: "submit", botId: bot.id, text: "Say hello", requestId: "r1" }));
	const deadline = Date.now() + 10_000;
	const texts = async () => {
		const history = await client.getHistory({ botId: bot.id });
		return history.entries.flatMap((entry) => (entry.kind === "message" ? [entry.text] : []));
	};
	while (!(await texts()).includes("Hello from Scout.") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
	expect(await texts()).toEqual(["Say hello", "Hello from Scout."]);
	expect(frames.some((frame) => frame.type === "ready")).toBe(true);
	expect(frames.some((frame) => (frame.type === "view" || frame.type === "ops") && "botId" in frame && frame.botId === bot.id)).toBe(true);
	socket.close();
});
