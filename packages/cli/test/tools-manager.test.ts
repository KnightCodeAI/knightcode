import type * as ChildProcess from "node:child_process";
import type * as Fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTool, getLatestVersion, type ToolStatus } from "../src/utils/tools-manager.ts";

const originalOffline = process.env.KNIGHTCODE_OFFLINE;

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
	};
});

vi.mock("child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof ChildProcess>();
	return {
		...actual,
		spawnSync: vi.fn(() => ({ error: new Error("not found") })),
	};
});

afterEach(() => {
	if (originalOffline === undefined) delete process.env.KNIGHTCODE_OFFLINE;
	else process.env.KNIGHTCODE_OFFLINE = originalOffline;
	vi.unstubAllGlobals();
});

function redirectResponse(location: string): Response {
	return new Response(null, { status: 302, headers: { location } });
}

describe("getLatestVersion", () => {
	it("resolves the version from the release page redirect", async () => {
		const fetchMock = vi.fn(async () => redirectResponse("https://github.com/sharkdp/fd/releases/tag/v10.4.2"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestVersion("sharkdp/fd")).resolves.toBe("10.4.2");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://github.com/sharkdp/fd/releases/latest",
			expect.objectContaining({ redirect: "manual" }),
		);
	});

	it("keeps tags without a v prefix intact", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0")),
		);

		await expect(getLatestVersion("BurntSushi/ripgrep")).resolves.toBe("15.2.0");
	});

	it("resolves relative redirect targets", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("/sharkdp/fd/releases/tag/v10.4.2")),
		);

		await expect(getLatestVersion("sharkdp/fd")).resolves.toBe("10.4.2");
	});

	it("discards the redirect response body", async () => {
		const response = new Response("<html></html>", {
			status: 302,
			headers: { location: "https://github.com/sharkdp/fd/releases/tag/v10.4.2" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response),
		);

		await expect(getLatestVersion("sharkdp/fd")).resolves.toBe("10.4.2");
		expect(response.bodyUsed).toBe(true);
	});

	it("fails clearly when the endpoint does not redirect", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("not found", { status: 404 })),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow(
			"Failed to resolve latest sharkdp/fd release: HTTP 404 without redirect",
		);
	});

	it("fails clearly when the redirect does not point at a release tag", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("https://github.com/login")),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow(
			"Failed to resolve latest sharkdp/fd release: unexpected redirect to https://github.com/login",
		);
	});

	it("rejects a redirect to another host", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("https://example.invalid/sharkdp/fd/releases/tag/v9.9.9")),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow("unexpected redirect");
	});

	it("rejects a redirect carrying the release path only in the query string", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("https://github.com/login?return_to=/releases/tag/v9.9.9")),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow("unexpected redirect");
	});

	it("rejects a release tag belonging to another repository", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("https://github.com/someone/else/releases/tag/v9.9.9")),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow("unexpected redirect");
	});

	it("rejects a tag whose escapes decode into path separators", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("https://github.com/sharkdp/fd/releases/tag/v9.9.9%2F..%2Fevil")),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow("unexpected redirect");
	});

	it("rejects a tag with a malformed percent escape", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("https://github.com/sharkdp/fd/releases/tag/v9.9.9%zz")),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow("unexpected redirect");
	});

	it("rejects a malformed Location header", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => redirectResponse("http://[")),
		);

		await expect(getLatestVersion("sharkdp/fd")).rejects.toThrow("unexpected redirect");
	});
});

describe("ensureTool", () => {
	it("reports status through a callback without writing to the console", async () => {
		process.env.KNIGHTCODE_OFFLINE = "1";
		const statuses: ToolStatus[] = [];
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await ensureTool("fd", (status) => statuses.push(status));

		expect(result).toBeUndefined();
		expect(statuses).toEqual([
			{
				type: "warning",
				message: "fd not found. Offline mode enabled, skipping download.",
			},
		]);
		expect(consoleLog).not.toHaveBeenCalled();
		consoleLog.mockRestore();
	});

	it("surfaces the error cause when a download fails", async () => {
		delete process.env.KNIGHTCODE_OFFLINE;
		const cause = new Error("connect ETIMEDOUT 140.82.113.3:443");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed", { cause });
			}),
		);
		const statuses: ToolStatus[] = [];

		const result = await ensureTool("fd", (status) => statuses.push(status));

		expect(result).toBeUndefined();
		expect(statuses).toEqual([
			{ type: "info", message: "fd not found. Downloading..." },
			{
				type: "warning",
				message: "Failed to download fd: fetch failed (cause: connect ETIMEDOUT 140.82.113.3:443)",
			},
		]);
	});

	it("surfaces every address attempt when the cause is an AggregateError", async () => {
		delete process.env.KNIGHTCODE_OFFLINE;
		const cause = new AggregateError([
			Object.assign(new Error("connect ETIMEDOUT 140.82.113.3:443"), { code: "ETIMEDOUT" }),
			Object.assign(new Error("connect ENETUNREACH 2606:50c0::1:443"), { code: "ENETUNREACH" }),
		]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed", { cause });
			}),
		);
		const statuses: ToolStatus[] = [];

		await ensureTool("fd", (status) => statuses.push(status));

		expect(statuses.at(-1)).toEqual({
			type: "warning",
			message: "Failed to download fd: fetch failed (ETIMEDOUT, ENETUNREACH)",
		});
	});
});
