// Small primitives the sign-in modules share: random tokens, hashes, keyed hashes and cookies. Web Crypto only.

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** `bytes` random bytes, base64url. */
export function randomToken(bytes = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
	return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}

/** HMAC-SHA-256 of `text` under `secret`, base64url. */
export async function hmac(secret: string, text: string): Promise<string> {
	return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(text))));
}

/** Whether `signature` is the HMAC of `text`, checked in constant time by Web Crypto. */
export async function hmacVerify(secret: string, text: string, signature: string): Promise<boolean> {
	let bytes: Uint8Array;
	try {
		bytes = fromBase64url(signature);
	} catch {
		return false;
	}
	return crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, encoder.encode(text));
}

/** One cookie's value from a request, or undefined. */
export function readCookie(request: Request, name: string): string | undefined {
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (key === name) return value.join("=");
	}
	return undefined;
}

/** A Set-Cookie value: always HttpOnly, Secure and SameSite=Lax. */
export function cookie(name: string, value: string, options: { path?: string; maxAgeSeconds: number }): string {
	return `${name}=${value}; Path=${options.path ?? "/"}; Max-Age=${options.maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

/** A path on this site to send the user back to: anything else (another origin, `//host`) becomes "/". */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
	return next;
}
