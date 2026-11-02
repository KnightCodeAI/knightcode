// apps/bots/test/bot.test.ts
import { applyImmutable, type Op } from "@knightcode/chord/delta";
import type { ConversationView, ServerFrame } from "@knightcode/bots-protocol";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import { issueTicket } from "../src/auth/tickets.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { fakeModels } from "./fake-model.ts";
import { signedInPrincipal } from "./helpers.ts";

let principal: Principal;
let other: Principal;
beforeAll(async () => {
	principal = await signedInPrincipal();
	other = await signedInPrincipal();
});

beforeEach(async () => {
	await botStub("b1").claim(principal, { provider: "fake", modelId: "fake-model" });
});
afterEach(() => setModelsFactory(undefined));

it("resumes a dropped stream with no gap and no duplicate text", async () => {
	setModelsFactory(fakeTo([{ text: "one two three four five" }]));
	const first = await openSocket("b1");
	await first.submit("go");
	await first.untilText("two");
	first.drop();
	const second = await openSocket("b1", first.resumeToken);
	const text = await second.untilDone();
	expect(text).toBe("one two three four five");
	// It caught up from the version it held, never from a whole new view.
	expect(second.views).toBe(0);
});
it("resumes work after eviction with no client connected", async () => {
	setModelsFactory(fakeTo([{ text: "done", delayMs: 50 }]));
	await botStub("b1").submit(principal, "go", "r1");
	await evict("b1");
	await runAlarm("b1");
	expect(await lastAssistantText("b1")).toBe("done");
});
it("resumes after eviction during a retry backoff", async () => {
	setModelsFactory(fakeTo([{ error: "503 Service Unavailable: overloaded" }, { text: "recovered" }]));
	await botStub("b1").submit(principal, "go", "r-backoff");
	// The failed attempt sleeps until its retry, with the object's alarm armed for it.
	const alarm = await backoffAlarm("b1");
	expect(alarm).toBeGreaterThan(Date.now());
	await evict("b1");
	expect(await lastAssistantText("b1")).toBe("recovered");
}, 20_000);
it("resumes work admitted just before an eviction", async () => {
	setModelsFactory(fakeTo([{ text: "admitted" }]));
	await runInDurableObject(botStub("b1"), async (instance, state) => {
		await (instance as unknown as BotObject).submit(principal, "go", "r-admitted");
		// Evicted before the harness's wake report could land: the alarm armed before submitting still stands.
		expect(await state.storage.getAlarm()).not.toBeNull();
		state.abort("evicted");
	}).catch(() => undefined);
	await runAlarm("b1");
	expect(await lastAssistantText("b1")).toBe("admitted");
});
it("refuses another account's socket and RPC", async () => {
	await expect(openSocket("b1", undefined, otherAccountTicket())).rejects.toThrow(/unauthorized/);
	// Called on the instance: the test pool's RPC wrapper reports any rejected call as unhandled.
	await expect(
		runInDurableObject(botStub("b1"), (instance) => (instance as unknown as BotObject).submit(other, "go", "r2")),
	).rejects.toThrow(/unauthorized/);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const fakeTo = (replies: Parameters<typeof fakeModels>[0]) => {
	const models = fakeModels(replies);
	return () => models;
};

const botStub = (botId: string) => env.BOT.get(env.BOT.idFromName(botId));

const otherAccountTicket = () => issueTicket(env, other, "socket");

/** Resets the object as an eviction would: the next call starts a fresh instance over the same storage. */
async function evict(botId: string): Promise<void> {
	await runInDurableObject(botStub(botId), (_instance, state) => state.abort("evicted")).catch(() => undefined);
}

/** The object's alarm once it is set for a retry backoff: seconds ahead, not the minute-long heartbeat. */
async function backoffAlarm(botId: string): Promise<number> {
	for (const deadline = Date.now() + 3_000; Date.now() < deadline; await new Promise((resolve) => setTimeout(resolve, 20))) {
		const at = await runInDurableObject(botStub(botId), (_instance, state) => state.storage.getAlarm());
		if (at !== null && at > Date.now() + 500 && at < Date.now() + 10_000) return at;
	}
	throw new Error("no backoff alarm");
}

async function runAlarm(botId: string): Promise<void> {
	await runDurableObjectAlarm(botStub(botId));
}

async function lastAssistantText(botId: string): Promise<string> {
	const socket = await openSocket(botId);
	try {
		return await socket.untilDone();
	} finally {
		socket.drop();
	}
}

type ResumeToken = { version: number; view: ConversationView };

async function until<T>(read: () => T | undefined, what: string, timeoutMs = 4_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = read();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** A client of one bot's socket that applies view and ops frames as the web app does. */
async function openSocket(botId: string, resume?: ResumeToken, ticket?: Promise<string>) {
	const response = await SELF.fetch(`https://bots.knightcode.dev/api/bots/${botId}/socket`, {
		headers: { upgrade: "websocket", origin: "https://bots.knightcode.dev" },
	});
	const socket = response.webSocket;
	if (!socket) throw new Error(`no socket (status ${response.status})`);
	socket.accept();
	let state: ResumeToken | undefined = resume;
	let views = 0;
	let ready = false;
	let failure: string | undefined;
	socket.addEventListener("message", (event) => {
		const frame = JSON.parse(String(event.data)) as ServerFrame;
		if (frame.type === "ready") ready = true;
		else if (frame.type === "error") failure = frame.code;
		else if (frame.type === "view") {
			views++;
			state = { version: frame.version, view: frame.view };
		} else if (frame.type === "ops") {
			if (!state || frame.version !== state.version + 1) throw new Error(`gap before version ${frame.version}`);
			state = { version: frame.version, view: applyImmutable(state.view, frame.ops as Op[]) };
		}
	});
	socket.send(JSON.stringify({ type: "auth", ticket: await (ticket ?? issueTicket(env, principal, "socket")) }));
	await until(() => (ready || failure ? true : undefined), "ready");
	if (failure) throw new Error(failure);
	socket.send(JSON.stringify({ type: "subscribe", botId, ...(resume ? { since: resume.version } : {}) }));
	const assistant = () => state?.view.entries.filter((entry) => entry.kind === "message" && entry.role === "assistant").at(-1);
	return {
		get resumeToken(): ResumeToken {
			if (!state) throw new Error("no view yet");
			return state;
		},
		get views() {
			return views;
		},
		async submit(text: string) {
			socket.send(JSON.stringify({ type: "submit", botId, text, requestId: crypto.randomUUID() }));
		},
		untilText: (text: string) =>
			until(() => {
				const last = assistant();
				return last?.kind === "message" && last.text.includes(text) ? true : undefined;
			}, `"${text}"`),
		untilDone: () =>
			until(() => {
				const last = assistant();
				if (!state || state.view.running || last?.kind !== "message" || last.streaming) return undefined;
				return last.text;
			}, "the answer"),
		drop: () => socket.close(1000, "drop"),
	};
}
