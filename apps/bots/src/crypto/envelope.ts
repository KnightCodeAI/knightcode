// Envelope encryption (spec section 21): each record has its own AES-256-GCM data key, stored wrapped by the
// key-encryption key (AES-KW). Every seal uses a fresh random 96-bit IV and binds the record's id as additional
// authenticated data, so a sealed value moved to another record does not open. Web Crypto only.
import { base64url, fromBase64url } from "../auth/util.ts";

const VERSION = "v1";
const IV_BYTES = 12;
const encoder = new TextEncoder();

/** A new data key, and the same key wrapped by `kek` for storage beside the record. */
export async function createDataKey(kek: CryptoKey): Promise<{ key: CryptoKey; wrapped: string }> {
	// A symmetric algorithm yields one key, never a pair.
	const key = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])) as CryptoKey;
	const wrapped = new Uint8Array(await crypto.subtle.wrapKey("raw", key, kek, "AES-KW"));
	return { key, wrapped: base64url(wrapped) };
}

/** The data key inside `wrapped`; it cannot be exported again. */
export async function unwrapDataKey(kek: CryptoKey, wrapped: string): Promise<CryptoKey> {
	return crypto.subtle.unwrapKey("raw", fromBase64url(wrapped), kek, "AES-KW", "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts `plaintext` for the record named by `aad`: "v1." then base64url(IV and ciphertext with its tag). */
export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<string> {
	return `${VERSION}.${base64url(await sealBytes(key, plaintext, aad))}`;
}

/** Decrypts what `seal` made for the same `aad`; throws on any other record's AAD, a changed byte or another key. */
export async function open(key: CryptoKey, sealed: string, aad: string): Promise<Uint8Array> {
	const [version, body, extra] = sealed.split(".");
	if (version !== VERSION || !body || extra !== undefined) throw new Error("not a sealed value");
	return openBytes(key, fromBase64url(body), aad);
}

/** IV then ciphertext (which ends with the 16-byte GCM tag). */
export async function sealBytes(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, plaintext),
	);
	const out = new Uint8Array(IV_BYTES + ciphertext.length);
	out.set(iv);
	out.set(ciphertext, IV_BYTES);
	return out;
}

export async function openBytes(key: CryptoKey, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
	if (sealed.length < IV_BYTES + 16) throw new Error("sealed value too short");
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES), additionalData: encoder.encode(aad) },
		key,
		sealed.subarray(IV_BYTES),
	);
	return new Uint8Array(plaintext);
}
