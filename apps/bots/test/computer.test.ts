// apps/bots/test/computer.test.ts
// The real ComputerObject over the fake provider (the Workers pool runs no containers; computer/test/image.test.sh
// covers the image itself).
import type { Transport } from "@knightcode/env";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { type ComputerObject, fakeComputers, setComputerClock } from "../src/computer/computer-object.ts";
import { botUserFor, chromeProfileDir, SHARED_DIR } from "../src/computer/provider.ts";
import { ViewOnlyFilter } from "../src/computer/screens.ts";
import { hostsBlock, netguardConfig } from "../src/computer/abuse.ts";
import { chromeFlags } from "../computer/desktop/chrome-flags.ts";
import { unitCost } from "../src/user/balance.ts";
import { fakeModels } from "./fake-model.ts";

const MINUTE = 60_000;
let now = Date.UTC(2026, 10, 2, 9);
setComputerClock(() => now);
afterEach(() => setModelsFactory(undefined));

it("sleeps after 10 idle minutes and reserves computer time in 5-minute blocks", async () => {
	const account = "acct-idle";
	await grant(account, 100);
	const lease = await acquire(account, "b1");
	expect(fakeComputers.get(account)!.running).toBe(true);
	expect((await balance(account)).reserved).toBe(unitCost("computer"));
	await computer(account).release(lease);

	// Five minutes on: the first block is spent and the next reserved; still awake.
	now += 5 * MINUTE;
	await runDurableObjectAlarm(computer(account));
	expect(fakeComputers.get(account)!.running).toBe(true);
	expect((await balance(account)).spent).toBe(unitCost("computer"));

	// Ten idle minutes: saved, then asleep, and the second block settled.
	now += 5 * MINUTE;
	await runDurableObjectAlarm(computer(account));
	expect(fakeComputers.get(account)!.running).toBe(false);
	expect(await computer(account).status()).toMatchObject({ state: "stopped", stoppedReason: "idle", savedGeneration: 1 });
	expect((await balance(account)).spent).toBe(2 * unitCost("computer"));
	expect((await balance(account)).reserved).toBe(0);
});

it("stays awake while a bot run holds it", async () => {
	const account = "acct-busy";
	await grant(account, 100);
	const lease = await acquire(account, "b1");
	now += 11 * MINUTE;
	await computer(account).heartbeat(lease);
	await runDurableObjectAlarm(computer(account));
	expect(fakeComputers.get(account)!.running).toBe(true);
});

it("stops the computer at the spending limit and keeps chat working", async () => {
	const account = "acct-limit";
	// Exactly one block of computer time.
	await grant(account, unitCost("computer"));
	await acquire(account, "b1");
	now += 5 * MINUTE;
	await runDurableObjectAlarm(computer(account));
	expect(fakeComputers.get(account)!.running).toBe(false);
	expect(await computer(account).status()).toMatchObject({ state: "stopped", stoppedReason: "spending_limit" });
	expect(await computer(account).acquire("b1", "run")).toEqual({ refused: "spending_limit" });

	// Chat runs on the user's own provider, not the computer: it still answers.
	const models = fakeModels([{ text: "still here" }]);
	setModelsFactory(() => models);
	const principal: Principal = { accountId: account, workspaceId: account, client: "web" };
	const bot = env.BOT.get(env.BOT.idFromName("limit-bot"));
	await bot.claim(principal, { provider: "fake", modelId: "fake-model" });
	await bot.submit(principal, "hello", "r-limit");
	expect(await lastAnswer("limit-bot")).toBe("still here");
});

it("expires screen URLs, revokes them, and never lets a view send input", async () => {
	const account = "acct-screen";
	const principal: Principal = { accountId: account, workspaceId: account, client: "web" };
	const view = await computer(account).screenUrl(principal, "b1", "view");
	const token = view.url.split("/").pop()!;
	expect(await computer(account).checkScreen(token)).toMatchObject({ botId: "b1", mode: "view" });
	// Another account's computer does not honour it.
	expect(await computer("acct-other").checkScreen(token)).toBeUndefined();

	now += 5 * MINUTE + 1;
	expect(await computer(account).checkScreen(token)).toBeUndefined();
	const expired = await SELF.fetch(view.url, { headers: { upgrade: "websocket" } });
	expect(expired.status).toBe(403);

	const control = await computer(account).screenUrl(principal, "b1", "control");
	const controlToken = control.url.split("/").pop()!;
	expect(await computer(account).checkScreen(controlToken)).toMatchObject({ mode: "control" });
	await computer(account).revokeScreens("b1");
	expect(await computer(account).checkScreen(controlToken)).toBeUndefined();

	// A viewer's messages: the RFB handshake and pixel requests pass; keys, pointer and clipboard do not.
	const filter = new ViewOnlyFilter();
	expect([filter.allow(rfb("RFB 003.008\n")), filter.allow(new Uint8Array([2])), filter.allow(new Uint8Array([1]))]).toEqual([
		true,
		true,
		true,
	]);
	expect(filter.allow(new Uint8Array([3, 0, 0, 0, 0, 0, 4, 0, 3, 0]))).toBe(true);
	expect(filter.allow(new Uint8Array([5, 1, 0, 10, 0, 10]))).toBe(false);
	expect(filter.allow(new Uint8Array([4, 1, 0, 0, 0, 0, 0, 65]))).toBe(false);
	expect(filter.allow(new Uint8Array([6, 0, 0, 0, 0, 0, 0, 1, 120]))).toBe(false);
});

it("keeps one bot's shell out of another bot's Chrome profile", async () => {
	const account = "acct-users";
	await grant(account, 100);
	await acquire(account, "b1");
	await acquire(account, "b2");
	const [user1, user2] = [await botUserFor("b1"), await botUserFor("b2")];
	expect(user1).not.toBe(user2);
	const replies = await runInDurableObject(computer(account), async (instance) => {
		const object = instance as unknown as ComputerObject;
		const shell1 = await object.openTransport("b1");
		const shell2 = await object.openTransport("b2");
		const results = {
			otherProfile: await ask(shell1, { read: `${chromeProfileDir(user2)}/Default/Cookies` }),
			ownProfile: await ask(shell1, { read: `${chromeProfileDir(user1)}/Default/Cookies` }),
			writeOtherHome: await ask(shell1, { write: `/home/${user2}/note.txt`, data: "hi" }),
			writeShared: await ask(shell1, { write: `${SHARED_DIR}/report.txt`, data: "shared" }),
			readShared: await ask(shell2, { read: `${SHARED_DIR}/report.txt` }),
		};
		const withoutLease = await object.openTransport("b3").then(
			() => "opened",
			(error: Error) => error.message,
		);
		return { ...results, withoutLease };
	});
	expect(replies.otherProfile).toEqual({ ok: false, error: "EACCES: permission denied" });
	expect(replies.ownProfile).toMatchObject({ ok: true });
	expect(replies.writeOtherHome).toMatchObject({ ok: false });
	expect(replies.readShared).toEqual({ ok: true, data: "shared" });
	expect(replies.withoutLease).toMatch(/does not hold/);
	// Each shell ran as its own bot's OS user.
	expect(fakeComputers.get(account)!.calls).toEqual(expect.arrayContaining([`transport:${account}:${user1}`, `transport:${account}:${user2}`]));
});

it("starts Chrome on loopback with WebRTC and QUIC kept to the proxy, and blocks mail and mining", () => {
	const direct = chromeFlags({ profileDir: "/home/bot_a/.config/chromium", debugPort: 9223, language: "de-DE" });
	expect(direct).toEqual(
		expect.arrayContaining([
			"--user-data-dir=/home/bot_a/.config/chromium",
			"--remote-debugging-address=127.0.0.1",
			"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
			"--lang=de-DE",
		]),
	);
	expect(direct).not.toContain("--disable-quic");
	const proxied = chromeFlags({ profileDir: "/p", debugPort: 9223, proxy: "socks5://127.0.0.1:1080" });
	expect(proxied).toEqual(expect.arrayContaining(["--proxy-server=socks5://127.0.0.1:1080", "--disable-quic"]));
	expect(netguardConfig()).toMatch(/^port 25$/m);
	expect(hostsBlock()).toMatch(/^0\.0\.0\.0 xmr\.nanopool\.org$/m);
});

it("loads the knightcode-env client in the Workers runtime", async () => {
	const envModule = await import("@knightcode/env");
	expect(typeof envModule.webSocketTransport).toBe("function");
	expect(typeof envModule.RemoteExecutionEnv).toBe("function");
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const computer = (account: string) => env.COMPUTER.get(env.COMPUTER.idFromName(account));
const user = (account: string) => env.USER.get(env.USER.idFromName(account));
const grant = (account: string, cents: number) => user(account).grantCredits(cents, `grant-${crypto.randomUUID()}`);
const balance = (account: string) => user(account).balance();

async function acquire(account: string, botId: string): Promise<string> {
	const result = await computer(account).acquire(botId, "run");
	if (!("leaseId" in result)) throw new Error(`refused: ${result.refused}`);
	return result.leaseId;
}

const rfb = (text: string) => new TextEncoder().encode(text);

function ask(transport: Transport, command: Record<string, string>): Promise<unknown> {
	return new Promise((resolve) => {
		transport.onFrame((frame) => resolve(JSON.parse(new TextDecoder().decode(frame))));
		transport.send(new TextEncoder().encode(JSON.stringify(command)));
	});
}

async function lastAnswer(botId: string): Promise<string> {
	const deadline = Date.now() + 4_000;
	for (;;) {
		const text = await runInDurableObject(env.BOT.get(env.BOT.idFromName(botId)), async (instance) => {
			const root = await (instance as unknown as BotObject).memory.conversation();
			const entry = (await root.entries({}, 10, undefined, undefined as never)).items.find(
				(item) => item.kind === "knightcode.assistant",
			);
			const message = entry?.model?.[0] as { content?: { type: string; text?: string }[] } | undefined;
			return message?.content?.find((block) => block.type === "text")?.text;
		});
		if (text) return text;
		if (Date.now() > deadline) throw new Error("no answer");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
