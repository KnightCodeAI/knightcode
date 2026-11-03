import type { FetchFunction } from "../types.ts";
import { GEMINI_WEB_BROWSER_HEADERS, mergeSessionCookies, readSetCookies } from "./gemini-web-cookies.ts";
import {
	GEMINI_WEB_INIT_URL,
	GEMINI_WEB_ORIGIN,
	type GeminiWebSession,
	parseGeminiWebInitPage,
} from "./gemini-web-protocol.ts";

const MAX_REDIRECTS = 3;
const INIT_TIMEOUT_MS = 30_000;

export class GeminiWebSessionWaitError extends Error {
	constructor() {
		super(
			"Gemini web could not initialize a signed-in session within 30 seconds. Session setup was stopped. Check connectivity and sign in again if necessary.",
		);
	}
}

/** HTTP failure shaped for `retryProviderRequest`, which retries only errors carrying `status` and `headers`. */
export class GeminiWebHttpError extends Error {
	status: number;
	headers: Headers | undefined;

	constructor(status: number, headers: Headers | undefined) {
		super(`Gemini web request failed with HTTP ${status}`);
		this.name = "GeminiWebHttpError";
		this.status = status;
		this.headers = headers;
	}
}

const SESSION_REJECTED =
	"Gemini web rejected the stored cookies. They may have expired or been signed out; log in again with fresh __Secure-1PSID and __Secure-1PSIDTS values.";

/**
 * Load the Gemini app page with the session cookies and read the tokens later requests need. Redirects are followed
 * by hand and only within gemini.google.com. The returned cookie includes any session cookie Google rotated on
 * the way. A page that sets a new session cookie but no access token is loaded once more with that cookie.
 */
export async function initGeminiWebSession(input: {
	cookie: string;
	fetch: FetchFunction;
	headers: Record<string, string>;
	signal?: AbortSignal;
}): Promise<{ session: GeminiWebSession; cookie: string }> {
	const deadline = AbortSignal.timeout(INIT_TIMEOUT_MS);
	const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
	try {
		const first = await loadGeminiWebPage({ ...input, signal });
		if (first.session) return { session: first.session, cookie: first.cookie };
		if (first.cookie !== input.cookie) {
			const second = await loadGeminiWebPage({ ...input, signal, cookie: first.cookie });
			if (second.session) return { session: second.session, cookie: second.cookie };
		}
		throw new Error(SESSION_REJECTED);
	} catch (error) {
		if (
			deadline.aborted &&
			!input.signal?.aborted &&
			(error === deadline.reason ||
				(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")))
		)
			throw new GeminiWebSessionWaitError();
		throw error;
	}
}

async function loadGeminiWebPage(input: {
	cookie: string;
	fetch: FetchFunction;
	headers: Record<string, string>;
	signal?: AbortSignal;
}): Promise<{ session?: GeminiWebSession; cookie: string }> {
	let url = GEMINI_WEB_INIT_URL;
	let cookie = input.cookie;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const response = await input.fetch(url, {
			method: "GET",
			redirect: "manual",
			headers: {
				...input.headers,
				...GEMINI_WEB_BROWSER_HEADERS,
				Cookie: cookie,
				Referer: `${GEMINI_WEB_ORIGIN}/`,
			},
			signal: input.signal,
		});
		cookie = mergeSessionCookies(cookie, readSetCookies(response.headers));
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			const next = location ? new URL(location, url) : undefined;
			if (next?.origin === GEMINI_WEB_ORIGIN) {
				// Strip chat-specific paths (/app/<chatId>) to avoid binding the session to an existing
				// conversation, which causes context bleed from previous chats.
				const cleanPath = next.pathname.replace(/^\/app\/.+/, "/app");
				url = `${next.origin}${cleanPath}${next.search}`;
				continue;
			}
			return { cookie };
		}
		if (!response.ok) throw new GeminiWebHttpError(response.status, response.headers);
		const session = parseGeminiWebInitPage(await response.text());
		return { session, cookie };
	}
	throw new Error("Gemini web redirected too many times while loading the session");
}
