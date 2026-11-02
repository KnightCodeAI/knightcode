// apps/bots/test/desktop-link.test.ts
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import { issueTicket } from "../src/auth/tickets.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { BOT_TAG, ephemeralKey, joinScript } from "../src/computer/tailscale.ts";
import { OFFLINE } from "../src/desktop/link.ts";
import type { UserObject } from "../src/user/user-object.ts";
import { fakeModels } from "./fake-model.ts";
import { signedInPrincipal } from "./helpers.ts";

let owner: Principal;
beforeAll(async () => {
	owner = await signedInPrincipal();
	const models = fakeModels([{ text: "ok" }]);
	setModelsFactory(() => models);
});

const user = () => env.USER.get(env.USER.idFromName(owner.accountId));
const bot = (id: string) => env.BOT.get(env.BOT.idFromName(id));
/** Waits until `check` holds (the socket's frames are handled asynchronously), up to five seconds. */
async function until(check: () => Promise<boolean> | boolean) {
	const deadline = Date.now() + 5_000;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error("timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
/** Completes an enrollment in the object itself (a rejected RPC would surface as unhandled in this test pool). */
const complete = (token: string, credential: never) =>
	runInDurableObject(user(), (instance: UserObject) => instance.completeEnrollment(token, credential).then(() => "stored", (error: Error) => error.message));

const runOnMyComputer = (botId: string, command: string) =>
	runInDurableObject(bot(botId), async (instance) => {
		const tool = (instance as unknown as BotObject).tools().find((candidate) => candidate.name === "run_on_my_computer")!;
		const result = (await tool.execute({ command } as never, undefined as never, undefined as never)) as { output: { text: string }[]; isError?: boolean };
		return { text: result.output[0]!.text, isError: result.isError ?? false };
	});

/** A desktop app that links with `ticket` and answers each command with `answer`. */
async function linkDesktop(accountId: string, ticket: string, answer: (command: string) => Record<string, unknown>) {
	const response = await SELF.fetch(`https://bots.knightcode.dev/api/desktop/${accountId}/link`, { headers: { upgrade: "websocket" } });
	const socket = response.webSocket!;
	socket.accept();
	let closed: number | undefined;
	socket.addEventListener("close", (event) => void (closed = event.code));
	socket.addEventListener("message", (event) => {
		const frame = JSON.parse(String(event.data)) as { kind: string; id: string; command: string };
		if (frame.kind === "exec") socket.send(JSON.stringify({ kind: "exec-result", id: frame.id, ...answer(frame.command) }));
	});
	socket.send(JSON.stringify({ kind: "auth", ticket }));
	await until(async () => closed !== undefined || (await env.USER.get(env.USER.idFromName(accountId)).desktopOnline()));
	return { socket, closed: () => closed };
}

it("an enrollment token works once and expires after ten minutes", async () => {
	const credential = { type: "api_key", key: "sk-cloud" } as never;
	const first = await user().beginEnrollment("openai");
	expect(first.expiresAt - Date.now()).toBeGreaterThan(9.9 * 60_000);
	expect(first.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60_000);
	expect(await complete(first.token, credential)).toBe("stored");
	expect(await complete(first.token, credential)).toMatch(/unknown, used or expired/);
	const second = await user().beginEnrollment("anthropic");
	// Ten minutes and a moment later.
	await runInDurableObject(user(), async (_instance: UserObject, state) => {
		state.storage.sql.exec("UPDATE enrollments SET expires_at = ?", Date.now() - 1);
	});
	expect(await complete(second.token, credential)).toMatch(/unknown, used or expired/);
});

it("runs a command through the linked desktop, and tells the bot the computer is offline when the app is closed", async () => {
	await bot("home-bot").claim(owner, { provider: "fake", modelId: "fake-model" });
	expect(await runOnMyComputer("home-bot", "ls")).toEqual({ text: OFFLINE, isError: true });

	// A ticket for another account is refused and links nothing.
	const stranger = await signedInPrincipal();
	const refused = await linkDesktop(owner.accountId, await issueTicket(env, stranger, "socket"), () => ({}));
	expect(refused.closed()).toBe(4401);
	expect(await user().desktopOnline()).toBe(false);

	const desktop = await linkDesktop(owner.accountId, await issueTicket(env, owner, "socket"), (command) =>
		command === "rm -rf ~" ? { refused: true } : { output: `ran ${command}`, exitCode: 0 },
	);
	expect(await user().desktopOnline()).toBe(true);
	expect(await runOnMyComputer("home-bot", "ls")).toEqual({ text: "exit 0\nran ls", isError: false });
	expect(await runOnMyComputer("home-bot", "rm -rf ~")).toMatchObject({ text: expect.stringMatching(/declined/), isError: true });

	desktop.socket.close(1000, "app closed");
	await until(async () => !(await user().desktopOnline()));
	expect(await user().desktopOnline()).toBe(false);
	expect(await runOnMyComputer("home-bot", "ls")).toEqual({ text: OFFLINE, isError: true });
});

it("joins Tailscale with a single-use ephemeral tagged key and an exit node through the local proxy", async () => {
	let body: unknown;
	const key = await ephemeralKey({
		apiToken: "tskey-api-test",
		fetch: (async (_url: string, init: RequestInit) => {
			body = JSON.parse(String(init.body));
			return Response.json({ key: "tskey-auth-once" });
		}) as never,
	});
	expect(key).toBe("tskey-auth-once");
	expect(body).toMatchObject({ capabilities: { devices: { create: { reusable: false, ephemeral: true, preauthorized: true, tags: [BOT_TAG] } } } });
	const script = joinScript({ key, hostname: "bot's computer", exitNode: "home-pc" });
	expect(script).toContain("--tun=userspace-networking");
	expect(script).toContain("--exit-node='home-pc'");
	expect(script).toContain(`--hostname='bot'\\''s computer'`);
	expect(joinScript({ key, hostname: "b" })).not.toContain("--exit-node");
});

it("review 3.15: a linked desktop whose session is revoked stops receiving commands", async () => {
	const signedIn = await signedInPrincipal();
	const account = env.USER.get(env.USER.idFromName(signedIn.accountId));
	await bot("revoked-bot").claim(signedIn, { provider: "fake", modelId: "fake-model" });
	const desktop = await linkDesktop(signedIn.accountId, await issueTicket(env, signedIn, "socket"), (command) => ({ output: `ran ${command}`, exitCode: 0 }));
	expect(await runOnMyComputer("revoked-bot", "ls")).toEqual({ text: "exit 0\nran ls", isError: false });
	await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(Date.now(), signedIn.sessionId).run();
	// The next check is due.
	await runInDurableObject(account, (_instance: UserObject, state) => {
		for (const socket of state.getWebSockets("desktop")) socket.serializeAttachment({ ...(socket.deserializeAttachment() as object), checkedAt: 0 });
	});
	expect(await runOnMyComputer("revoked-bot", "ls")).toEqual({ text: OFFLINE, isError: true });
	await until(() => desktop.closed() !== undefined);
});
