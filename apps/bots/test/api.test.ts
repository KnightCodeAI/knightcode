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

it("takes and releases control of a bot's screen", async () => {
	const client = api();
	await client.updateAccount({ defaultModel: { provider: "fake", modelId: "fake-model" } });
	const bot = await client.createBot({ name: "Screen" });
	const taken = await client.setControl({ botId: bot.id, take: true });
	expect(taken.screens).toContainEqual({ botId: bot.id, controller: "user" });
	const released = await client.setControl({ botId: bot.id, take: false });
	expect(released.screens).toContainEqual({ botId: bot.id, controller: "bot" });
	expect(await client.getComputer({})).toMatchObject({ status: expect.any(String), hoursIncluded: expect.any(Number) });
});

it("signs the desktop app in through the browser, and lets its renderer call the API with a short-lived ticket", async () => {
	const state = "desktop-state-0123456789";
	const handoff = await SELF.fetch(`${ORIGIN}/auth/desktop?state=${state}`, { headers: { cookie }, redirect: "manual" });
	expect(handoff.status).toBe(302);
	const link = new URL(handoff.headers.get("location")!);
	expect(link.protocol).toBe("knightcode:");
	const code = link.searchParams.get("code")!;
	const exchange = (body: unknown) => SELF.fetch(`${ORIGIN}/auth/desktop/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	expect((await exchange({ code, state: "another-state-0123456789" })).status).toBe(401);
	// The wrong state spent the code: only a fresh one works, and only once.
	const again = new URL((await SELF.fetch(`${ORIGIN}/auth/desktop?state=${state}`, { headers: { cookie }, redirect: "manual" })).headers.get("location")!).searchParams.get("code")!;
	const signedIn = (await (await exchange({ code: again, state })).json()) as { token: string; accountId: string };
	expect(signedIn.token).toBeTruthy();
	expect((await exchange({ code: again, state })).status).toBe(401);

	// The main process trades its session for an API ticket; the renderer calls the API with it from its own origin.
	const ticketResponse = await SELF.fetch(`${ORIGIN}/api/tickets`, { method: "POST", headers: { authorization: `Bearer ${signedIn.token}`, "content-type": "application/json" }, body: JSON.stringify({ scope: "api" }) });
	const { ticket } = (await ticketResponse.json()) as { ticket: string };
	const preflight = await SELF.fetch(`${ORIGIN}/api/account`, { method: "OPTIONS", headers: { origin: "app://desktop", "access-control-request-method": "PATCH" } });
	expect(preflight.status).toBe(204);
	expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");
	const account = await SELF.fetch(`${ORIGIN}/api/account`, { headers: { origin: "app://desktop", authorization: `Ticket ${ticket}` } });
	expect(account.status).toBe(200);
	expect(account.headers.get("access-control-allow-origin")).toBe("app://desktop");
	expect(((await account.json()) as { id: string }).id).toBe(signedIn.accountId);
	// A socket ticket is not an API ticket.
	const { ticket: socketTicket } = (await (await SELF.fetch(`${ORIGIN}/api/tickets`, { method: "POST", headers: { authorization: `Bearer ${signedIn.token}`, "content-type": "application/json" }, body: JSON.stringify({ scope: "socket" }) })).json()) as { ticket: string };
	expect((await SELF.fetch(`${ORIGIN}/api/account`, { headers: { authorization: `Ticket ${socketTicket}` } })).status).toBe(401);
	// Another site gets no CORS.
	expect((await SELF.fetch(`${ORIGIN}/api/account`, { headers: { origin: "https://evil.example", authorization: `Ticket ${ticket}` } })).headers.get("access-control-allow-origin")).toBeNull();
});
