// Web Push (spec section 15): VAPID-signed (RFC 8292) and encrypted with aes128gcm (RFC 8291), all with Web Crypto.
// The push service sees only the encrypted payload; a subscription the service reports gone (404, 410) is dropped.
import { base64url, fromBase64url } from "../auth/util.ts";

export interface PushSubscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export interface PushPayload {
	title: string;
	body?: string;
	path?: string;
	tag?: string;
}

const encoder = new TextEncoder();

const concat = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** The aes128gcm body for one subscription (a single record). */
export async function encryptPayload(subscription: PushSubscription, plaintext: Uint8Array): Promise<Uint8Array> {
	const uaPublic = fromBase64url(subscription.keys.p256dh);
	const authSecret = fromBase64url(subscription.keys.auth);
	const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
	const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer);
	const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
	// The runtime reads `public`; the Workers types spell it `$public`.
	const ecdh = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
	const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, ephemeral.privateKey, 256));
	const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic), 32);
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
	// The last (only) record ends with the 0x02 delimiter.
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
	const header = new Uint8Array(21);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, 4096);
	header[20] = asPublic.length;
	return concat(header, asPublic, sealed);
}

/** The VAPID Authorization header for `endpoint`'s push service, good for twelve hours. */
export async function vapidHeader(endpoint: string, keys: { publicKey: string; privateKey: string; subject: string }, now = Date.now()): Promise<string> {
	const publicRaw = fromBase64url(keys.publicKey);
	const jwk: JsonWebKey = {
		kty: "EC",
		crv: "P-256",
		x: base64url(publicRaw.slice(1, 33)),
		y: base64url(publicRaw.slice(33, 65)),
		d: keys.privateKey,
	};
	const signingKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
	const part = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));
	const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })}`;
	const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(unsigned)));
	return `vapid t=${unsigned}.${base64url(signature)}, k=${keys.publicKey}`;
}

let transport: typeof fetch = (input, init) => fetch(input, init);
/** Tests only: where push requests go (`undefined` restores the network). */
export function setPushTransport(next: typeof fetch | undefined): void {
	transport = next ?? ((input, init) => fetch(input, init));
}

/** Sends one push; "gone" when the push service no longer knows the subscription. */
export async function sendPush(
	subscription: PushSubscription,
	payload: PushPayload,
	keys: { publicKey: string; privateKey: string; subject: string },
): Promise<"sent" | "gone" | "failed"> {
	if (new URL(subscription.endpoint).protocol !== "https:") return "gone";
	const response = await transport(subscription.endpoint, {
		method: "POST",
		headers: {
			authorization: await vapidHeader(subscription.endpoint, keys),
			"content-encoding": "aes128gcm",
			"content-type": "application/octet-stream",
			ttl: "86400",
			urgency: "high",
		},
		body: await encryptPayload(subscription, encoder.encode(JSON.stringify(payload))),
	});
	if (response.status === 404 || response.status === 410) return "gone";
	return response.ok ? "sent" : "failed";
}
