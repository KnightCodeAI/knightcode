// apps/bots/test/push.test.ts
import { env } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import { base64url, fromBase64url } from "../src/auth/util.ts";
import { ACTIVE_MS } from "../src/push/presence.ts";
import { setPushTransport } from "../src/push/web-push.ts";

type Sent = { endpoint: string; authorization: string; payload: { title: string; body?: string; path?: string } };
let sent: Sent[] = [];
const subscriber = { keys: undefined as unknown as CryptoKeyPair, publicRaw: new Uint8Array(), auth: new Uint8Array(16) };

const encoder = new TextEncoder();
const concat = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) out.set(p, (o += p.length) - p.length);
	return out;
};
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** What the browser does: decrypt an aes128gcm push with the subscription's private key (RFC 8291). */
async function decrypt(body: Uint8Array): Promise<unknown> {
	const salt = body.slice(0, 16);
	const idLength = body[20]!;
	const asPublic = body.slice(21, 21 + idLength);
	const sealed = body.slice(21 + idLength);
	const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
	const ecdh = { name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
	const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, subscriber.keys.privateKey, 256));
	const ikm = await hkdf(subscriber.auth, shared, concat(encoder.encode("WebPush: info\0"), subscriber.publicRaw, asPublic), 32);
	const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
	const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed));
	expect(plain.at(-1)).toBe(2);
	return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

beforeAll(async () => {
	subscriber.keys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
	subscriber.publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", subscriber.keys.publicKey)) as ArrayBuffer);
	crypto.getRandomValues(subscriber.auth);
	setPushTransport((async (input: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		expect(headers.get("content-encoding")).toBe("aes128gcm");
		sent.push({
			endpoint: String(input),
			authorization: headers.get("authorization") ?? "",
			payload: (await decrypt(new Uint8Array(init!.body as Uint8Array))) as Sent["payload"],
		});
		return new Response(null, { status: 201 });
	}) as typeof fetch);
});
afterEach(() => {
	sent = [];
});

let accounts = 0;
async function account(previews = false) {
	const user = env.USER.get(env.USER.idFromName(`push-${++accounts}`));
	await user.subscribePush({ endpoint: `https://push.example/send/${accounts}`, keys: { p256dh: base64url(subscriber.publicRaw), auth: base64url(subscriber.auth) } });
	await user.setPushPreviews(previews);
	return user;
}
const notice = (level: "finish" | "input" | "never", text = "Here is the summary you asked for.") => ({ botId: "b1", botName: "Scout", kind: "finish" as const, level, text });

it("sends no push while the user is active, and one push once they are away", async () => {
	const user = await account();
	const now = Date.now();
	await user.presence(true, now);
	await user.notify(notice("finish"), now + 1_000);
	await user.notify({ ...notice("finish"), kind: "input" }, now + 2_000);
	expect(sent).toEqual([]);
	// Still active a moment later: nothing yet.
	await user.flushPushes(now + ACTIVE_MS - 1);
	expect(sent).toEqual([]);
	await user.flushPushes(now + ACTIVE_MS + 1);
	expect(sent).toHaveLength(1);
	expect(sent[0]!.payload).toEqual({ title: "KnightCode Bots", body: "2 updates from Scout", path: "/inbox", tag: "held" });
	// The VAPID token verifies with the server's public key and names the push service's origin.
	const [, token, k] = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(sent[0]!.authorization)!;
	expect(k).toBe(env.VAPID_PUBLIC_KEY);
	const [header, claims, signature] = token!.split(".");
	const verifier = await crypto.subtle.importKey("raw", fromBase64url(k!), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
	expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, fromBase64url(signature!), encoder.encode(`${header}.${claims}`))).toBe(true);
	expect(JSON.parse(new TextDecoder().decode(fromBase64url(claims!)))).toMatchObject({ aud: "https://push.example" });
	// Nothing left to send.
	await user.flushPushes(now + ACTIVE_MS + 2);
	expect(sent).toHaveLength(1);
	// Leaving outright sends what is held at once.
	await user.presence(true, now + ACTIVE_MS + 3);
	await user.notify(notice("finish"), now + ACTIVE_MS + 4);
	await user.presence(false, now + ACTIVE_MS + 5);
	expect(sent).toHaveLength(2);
});

it("sends nothing for a bot set to never, and only input for a bot set to input", async () => {
	const user = await account();
	await user.presence(false);
	await user.notify(notice("never"));
	await user.notify({ ...notice("never"), kind: "input" });
	await user.notify(notice("input"));
	expect(sent).toEqual([]);
	await user.notify({ ...notice("input"), kind: "input", text: "Approve sending the invoice?" });
	expect(sent.map((push) => push.payload.body)).toEqual(["Needs your input"]);
});

it("carries no message content beyond the preview the user allowed", async () => {
	const secret = "the account number is 12345678";
	const reply = `Done. I compared the three quotes and picked the cheapest one, which also arrives first; ${secret}`;
	const hidden = await account(false);
	await hidden.presence(false);
	await hidden.notify(notice("finish", reply));
	expect(JSON.stringify(sent[0]!.payload)).not.toMatch(/quotes|12345678/);
	expect(sent[0]!.payload).toEqual({ title: "Scout", body: "Finished", path: "/bots/b1", tag: "b1" });

	const shown = await account(true);
	await shown.presence(false);
	await shown.notify(notice("finish", reply));
	const body = sent[1]!.payload.body!;
	expect(body.length).toBeLessThanOrEqual(80);
	expect(body.startsWith("Done. I compared the three quotes")).toBe(true);
	expect(body).not.toContain("12345678");
});
