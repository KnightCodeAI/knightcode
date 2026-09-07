import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { deleteToken, ENV_CONFIG_DIR, login, readToken, writeToken } from "../src/auth.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function beginResponse(interval = 0): Response {
	return jsonResponse({
		device_code: "d",
		user_code: "AAAA-BBBB",
		verification_uri: "https://remote.knightcode.dev/device",
		interval,
		expires_in: 60,
	});
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("device-code login", () => {
	test("polls until the code is approved, then returns the token", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(beginResponse())
				.mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }))
				.mockResolvedValueOnce(jsonResponse({ token: "granted" })),
		);

		const seen: string[] = [];
		const token = await login("https://remote.knightcode.dev", (code) => seen.push(code), new AbortController().signal);
		expect(token).toBe("granted");
		expect(seen).toEqual(["AAAA-BBBB"]);
	});

	test("widens the interval on slow_down rather than giving up", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(beginResponse(1))
			.mockResolvedValueOnce(jsonResponse({ error: "slow_down" }))
			.mockResolvedValueOnce(jsonResponse({ token: "granted" }));
		vi.stubGlobal("fetch", fetchMock);

		const pending = login("https://remote.knightcode.dev", () => {}, new AbortController().signal);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		// The relay asked for a one second interval, so an unwidened poll would fire here.
		await vi.advanceTimersByTimeAsync(1_000);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(await pending).toBe("granted");
	});

	test("honours an interval the relay supplies with slow_down", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(beginResponse(1))
			.mockResolvedValueOnce(jsonResponse({ error: "slow_down", interval: 9 }))
			.mockResolvedValueOnce(jsonResponse({ token: "granted" }));
		vi.stubGlobal("fetch", fetchMock);

		const pending = login("https://remote.knightcode.dev", () => {}, new AbortController().signal);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(8_000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await pending).toBe("granted");
	});

	test("stops when the signal aborts", async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(beginResponse())
				.mockImplementation(async () => {
					controller.abort();
					return jsonResponse({ error: "authorization_pending" });
				}),
		);

		await expect(login("https://remote.knightcode.dev", () => {}, controller.signal)).rejects.toThrow(/cancelled/i);
	});

	test("surfaces a terminal error from the endpoint", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(beginResponse())
				.mockResolvedValueOnce(jsonResponse({ error: "expired_token" }, 400)),
		);

		await expect(login("https://remote.knightcode.dev", () => {}, new AbortController().signal)).rejects.toThrow(
			/expired_token/,
		);
	});
});

describe("token storage", () => {
	test("round-trips a token and removes it on logout", async () => {
		const dir = await mkdtemp(join(tmpdir(), "knightcode-remote-"));
		vi.stubEnv(ENV_CONFIG_DIR, dir);

		expect(await readToken()).toBeUndefined();
		await writeToken("secret-token");
		expect(await readToken()).toBe("secret-token");

		const written = await readFile(join(dir, "remote-auth.json"), "utf8");
		expect(JSON.parse(written)).toEqual({ token: "secret-token" });

		await deleteToken();
		expect(await readToken()).toBeUndefined();
	});

	test.skipIf(process.platform === "win32")("writes the token file owner-only", async () => {
		const dir = await mkdtemp(join(tmpdir(), "knightcode-remote-"));
		vi.stubEnv(ENV_CONFIG_DIR, dir);
		await writeToken("secret-token");
		expect((await stat(join(dir, "remote-auth.json"))).mode & 0o777).toBe(0o600);
	});

	test("deleting a token that was never written is not an error", async () => {
		const dir = await mkdtemp(join(tmpdir(), "knightcode-remote-"));
		vi.stubEnv(ENV_CONFIG_DIR, dir);
		await expect(deleteToken()).resolves.toBeUndefined();
	});
});
