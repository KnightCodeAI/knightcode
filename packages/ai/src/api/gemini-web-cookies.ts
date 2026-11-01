import type { FetchFunction } from "../types.ts";

const COOKIE_1PSID = "__Secure-1PSID";
const SESSION_COOKIE_NAMES = [COOKIE_1PSID, "__Secure-1PSIDTS", "__Secure-1PSIDCC"] as const;
const ROTATE_URL = "https://accounts.google.com/RotateCookies";
const ROTATE_INTERVAL_MS = 60_000;

/**
 * Stable browser identity. The KnightCode user agent changes with the build, and Google drops a Gemini web
 * session that comes back looking like a different client. Rotation also expects a browser, not an agent.
 */
export const GEMINI_WEB_BROWSER_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
};

const lastRotation = new Map<string, number>();

/** Test hook. Production rotation is remembered for the process so a burst of turns does not hammer Google. */
export function clearGeminiWebCookieRotation(): void {
	lastRotation.clear();
}

function sessionCookieJar(cookie: string): Map<string, string> {
	const jar = new Map<string, string>();
	for (const part of cookie.split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0) continue;
		const name = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();
		if (SESSION_COOKIE_NAMES.includes(name as (typeof SESSION_COOKIE_NAMES)[number]) && value) jar.set(name, value);
	}
	return jar;
}

function formatSessionCookies(jar: Map<string, string>): string {
	return SESSION_COOKIE_NAMES.filter((name) => jar.has(name))
		.map((name) => `${name}=${jar.get(name)}`)
		.join("; ");
}

export function readSetCookies(headers: Headers): string[] {
	if (typeof headers.getSetCookie === "function") {
		const values = headers.getSetCookie();
		if (values.length > 0) return values;
	}
	const combined = headers.get("set-cookie");
	return combined ? [combined] : [];
}

/** Apply Google's Set-Cookie updates to the session cookies. Other cookies are ignored. */
export function mergeSessionCookies(current: string, setCookies: readonly string[]): string {
	const jar = sessionCookieJar(current);
	let changed = false;
	for (const header of setCookies) {
		const semi = header.indexOf(";");
		const pair = (semi < 0 ? header : header.slice(0, semi)).trim();
		const separator = pair.indexOf("=");
		if (separator < 0) continue;
		const name = pair.slice(0, separator).trim();
		if (!SESSION_COOKIE_NAMES.includes(name as (typeof SESSION_COOKIE_NAMES)[number])) continue;
		const value = pair.slice(separator + 1).trim();
		if (!value) {
			changed = jar.delete(name) || changed;
			continue;
		}
		if (jar.get(name) !== value) {
			jar.set(name, value);
			changed = true;
		}
	}
	if (!changed || !jar.has(COOKIE_1PSID)) return current;
	return formatSessionCookies(jar);
}

/**
 * Ask Google to rotate the session cookies. A failure leaves the current cookie in place: the page load that
 * follows is what decides whether the session is still signed in. Throttled per `__Secure-1PSID`.
 */
export async function refreshGeminiWebCookies(input: {
	cookie: string;
	fetch: FetchFunction;
	signal?: AbortSignal;
}): Promise<string> {
	const psid = sessionCookieJar(input.cookie).get(COOKIE_1PSID);
	if (!psid) return input.cookie;
	const last = lastRotation.get(psid) ?? 0;
	if (Date.now() - last < ROTATE_INTERVAL_MS) return input.cookie;
	try {
		const response = await input.fetch(ROTATE_URL, {
			method: "POST",
			redirect: "manual",
			headers: {
				...GEMINI_WEB_BROWSER_HEADERS,
				"Content-Type": "application/json",
				Origin: "https://accounts.google.com",
				Referer: "https://accounts.google.com/",
				Cookie: input.cookie,
			},
			body: '[000,"-0000000000000000000"]',
			signal: input.signal,
		});
		if (!response.ok) return input.cookie;
		lastRotation.set(psid, Date.now());
		return mergeSessionCookies(input.cookie, readSetCookies(response.headers));
	} catch {
		return input.cookie;
	}
}
