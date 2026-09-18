import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { reportIdeInstall } from "../../src/engine/install-report.ts";

/**
 * No network, no session, no provider: the ping is a bare GET and the only
 * thing worth asserting is whether it happened and what it said.
 */
describe("reportIdeInstall", () => {
	const saved = {
		ideVersion: process.env.KNIGHTCODE_IDE_VERSION,
		offline: process.env.KNIGHTCODE_OFFLINE,
		telemetry: process.env.KNIGHTCODE_TELEMETRY,
	};
	let calls: string[];

	beforeEach(() => {
		calls = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				calls.push(String(input));
				return new Response(null, { status: 204 });
			}),
		);
		delete process.env.KNIGHTCODE_IDE_VERSION;
		delete process.env.KNIGHTCODE_OFFLINE;
		delete process.env.KNIGHTCODE_TELEMETRY;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		for (const [key, value] of [
			["KNIGHTCODE_IDE_VERSION", saved.ideVersion],
			["KNIGHTCODE_OFFLINE", saved.offline],
			["KNIGHTCODE_TELEMETRY", saved.telemetry],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	function ctx(settings: Partial<Parameters<typeof SettingsManager.inMemory>[0]> = {}) {
		return { settings: SettingsManager.inMemory(settings) };
	}

	test("reports nothing for a CLI user, who sets no IDE version", async () => {
		await reportIdeInstall(ctx());
		expect(calls).toEqual([]);
	});

	test("reports nothing when install telemetry is off", async () => {
		process.env.KNIGHTCODE_IDE_VERSION = "1.0.0 (stable)";
		await reportIdeInstall(ctx({ enableInstallTelemetry: false }));
		expect(calls).toEqual([]);
	});

	test("reports nothing when the environment variable overrides the setting", async () => {
		process.env.KNIGHTCODE_IDE_VERSION = "1.0.0 (stable)";
		process.env.KNIGHTCODE_TELEMETRY = "0";
		await reportIdeInstall(ctx({ enableInstallTelemetry: true }));
		expect(calls).toEqual([]);
	});

	test("reports nothing when offline", async () => {
		process.env.KNIGHTCODE_IDE_VERSION = "1.0.0 (stable)";
		process.env.KNIGHTCODE_OFFLINE = "1";
		await reportIdeInstall(ctx());
		expect(calls).toEqual([]);
	});

	test("reports once per version, not once per engine start", async () => {
		process.env.KNIGHTCODE_IDE_VERSION = "1.0.0 (stable)";
		const context = ctx();

		await reportIdeInstall(context);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe(
			"https://knightcode.dev/api/report-install?version=1.0.0%20(stable)",
		);
		expect(context.settings.getLastIdeVersion()).toBe("1.0.0 (stable)");

		// The engine restarts; the same version must not ping again.
		await reportIdeInstall(context);
		expect(calls).toHaveLength(1);

		process.env.KNIGHTCODE_IDE_VERSION = "1.1.0 (stable)";
		await reportIdeInstall(context);
		expect(calls).toHaveLength(2);
	});

	test("leaves the CLI's changelog marker alone", async () => {
		process.env.KNIGHTCODE_IDE_VERSION = "1.0.0 (stable)";
		const context = ctx({ lastChangelogVersion: "0.4.2" });
		await reportIdeInstall(context);
		expect(context.settings.getLastChangelogVersion()).toBe("0.4.2");
	});
});
