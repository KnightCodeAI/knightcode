import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGeminiWebCookieRotation, refreshGeminiWebCookies } from "../src/api/gemini-web-cookies.ts";
import { stream } from "../src/api/gemini-web.ts";
import { GeminiWebHttpError, GeminiWebSessionWaitError, initGeminiWebSession } from "../src/api/gemini-web-session.ts";
import { geminiWebProvider } from "../src/providers/gemini-web.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { isRetryableAssistantError } from "../src/utils/retry.ts";

const COOKIE = "__Secure-1PSID=fixture; __Secure-1PSIDTS=old";

afterEach(() => {
	clearGeminiWebCookieRotation();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function pendingResponse(signal: AbortSignal | undefined | null): Promise<Response> {
	return new Promise((_resolve, reject) => {
		if (signal?.aborted) reject(signal.reason);
		else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

describe("Gemini web bounded setup", () => {
	it("bounds best-effort cookie rotation at ten seconds and retains the existing cookies", async () => {
		const deadline = new AbortController();
		const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => pendingResponse(init?.signal));
		const result = refreshGeminiWebCookies({ cookie: COOKIE, fetch: fetch as typeof globalThis.fetch });
		deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
		expect(await result).toBe(COOKIE);
		expect(timeout).toHaveBeenCalledWith(10_000);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("throttles failed rotation attempts instead of delaying every tool round", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		const fetch = vi.fn(async () => new Response("unavailable", { status: 500 }));
		const input = { cookie: COOKIE, fetch: fetch as typeof globalThis.fetch };
		expect(await refreshGeminiWebCookies(input)).toBe(COOKIE);
		expect(await refreshGeminiWebCookies(input)).toBe(COOKIE);
		clock.mockReturnValue(now + 59_000);
		await refreshGeminiWebCookies(input);
		expect(fetch).toHaveBeenCalledTimes(1);
		clock.mockReturnValue(now + 61_000);
		await refreshGeminiWebCookies(input);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("does not start cookie rotation for a cancelled caller", async () => {
		const caller = new AbortController();
		caller.abort();
		const fetch = vi.fn();
		expect(
			await refreshGeminiWebCookies({ cookie: COOKIE, fetch: fetch as typeof globalThis.fetch, signal: caller.signal }),
		).toBe(COOKIE);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each(["redirect", "rotated cookie"])("shares one 30-second setup limit across a %s", async (mode) => {
		const deadline = new AbortController();
		const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const second = Promise.withResolvers<void>();
		const signals: (AbortSignal | null | undefined)[] = [];
		const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			signals.push(init?.signal);
			if (signals.length === 1)
				return mode === "redirect"
					? new Response(null, { status: 302, headers: { location: "https://gemini.google.com/app?redirect=1" } })
					: new Response("no access token", { headers: { "set-cookie": "__Secure-1PSIDTS=new; Path=/; Secure" } });
			second.resolve();
			return pendingResponse(init?.signal);
		});
		const result = initGeminiWebSession({ cookie: COOKIE, headers: {}, fetch: fetch as typeof globalThis.fetch });
		await second.promise;
		deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
		await expect(result).rejects.toBeInstanceOf(GeminiWebSessionWaitError);
		expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
		expect(signals[0]).toBe(signals[1]);
	});

	it("keeps cancellation distinct from expired setup", async () => {
		const caller = new AbortController();
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => pendingResponse(init?.signal));
		const result = initGeminiWebSession({
			cookie: COOKIE,
			headers: {},
			fetch: fetch as typeof globalThis.fetch,
			signal: caller.signal,
		});
		const reason = new DOMException("User cancelled", "AbortError");
		caller.abort(reason);
		await expect(result).rejects.toBe(reason);
	});

	it("does not overwrite an HTTP error when setup's deadline also expires", async () => {
		const deadline = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const fetch = vi.fn(async () => {
			deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
			return new Response("usage limit", { status: 429 });
		});
		await expect(
			initGeminiWebSession({ cookie: COOKIE, headers: {}, fetch: fetch as typeof globalThis.fetch }),
		).rejects.toBeInstanceOf(GeminiWebHttpError);
	});

	it.each(["login", "generation"])(
		"does not repeat expired setup with pre-rotation cookies during %s",
		async (mode) => {
			const initDeadline = new AbortController();
			vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
				ms === 30_000 ? initDeadline.signal : new AbortController().signal,
			);
			const urls: string[] = [];
			const fetch = vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				urls.push(url);
				if (url.includes("RotateCookies"))
					return new Response("", { headers: { "set-cookie": "__Secure-1PSIDTS=rotated; Path=/; Secure" } });
				initDeadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
				throw initDeadline.signal.reason;
			});
			if (mode === "login") {
				vi.stubGlobal("fetch", fetch);
				const answers = ["fixture", "old"];
				await expect(
					geminiWebProvider().auth.apiKey!.login!({
						signal: new AbortController().signal,
						prompt: async () => answers.shift()!,
						notify: () => {},
					}),
				).rejects.toBeInstanceOf(GeminiWebSessionWaitError);
			} else {
				const result = await stream(
					geminiWebProvider().getModels()[0],
					normalizeContext({ messages: [{ role: "user", content: "Continue", timestamp: 1 }] }),
					{ apiKey: COOKIE, fetch: fetch as typeof globalThis.fetch },
				).result();
				expect(result.errorMessage).toContain("Session setup was stopped");
				expect(isRetryableAssistantError(result)).toBe(false);
			}
			expect(urls.filter((url) => new URL(url).pathname === "/app")).toHaveLength(1);
			expect(urls.some((url) => url.includes("StreamGenerate"))).toBe(false);
		},
	);
});
