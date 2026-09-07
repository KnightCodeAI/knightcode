const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Unguessable identifier carrying `bytes` bytes of entropy, rendered in Crockford base32.
 * One random byte per output character, masked to 5 bits: emitting two characters from a
 * single byte would render 8 bits of entropy as 10 bits' worth of text and halve the real
 * strength of every id. 16 bytes is the room id strength; 32 is used for tokens.
 */
export function randomId(bytes: number): string {
	const length = Math.ceil((bytes * 8) / 5);
	const raw = crypto.getRandomValues(new Uint8Array(length));
	let output = "";
	for (const byte of raw) output += CROCKFORD[byte & 31];
	return output;
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function key(secret: string): Promise<CryptoKey> {
	if (!secret) throw new Error("SIGNING_SECRET is not set - see apps/remote/DEPLOYING.md");
	return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}

function toBase64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | undefined {
	try {
		const padded = value.replaceAll("-", "+").replaceAll("_", "/");
		return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
	} catch {
		return undefined;
	}
}

/** Returns `<payload>.<signature>`. Verification splits on the last dot, so a payload may contain one. */
export async function sign(secret: string, payload: string): Promise<string> {
	const signature = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(payload));
	return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verify(secret: string, signed: string): Promise<string | undefined> {
	const separator = signed.lastIndexOf(".");
	if (separator <= 0) return undefined;
	const payload = signed.slice(0, separator);
	const signature = fromBase64Url(signed.slice(separator + 1));
	if (!signature) return undefined;
	const valid = await crypto.subtle.verify("HMAC", await key(secret), signature, new TextEncoder().encode(payload));
	return valid ? payload : undefined;
}
