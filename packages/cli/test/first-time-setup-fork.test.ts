import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.ts", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...(actual as Record<string, unknown>),
		PACKAGE_NAME: "@example/@knightcodeai/cli",
	};
});

import { shouldRunFirstTimeSetup } from "../src/cli/startup-ui.ts";

describe("shouldRunFirstTimeSetup in forked distributions", () => {
	const originalPiExperimental = process.env.KNIGHTCODE_EXPERIMENTAL;
	let tempDir: string;
	let settingsPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "knightcode-first-time-setup-fork-"));
		settingsPath = join(tempDir, "settings.json");
		process.env.KNIGHTCODE_EXPERIMENTAL = "1";
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		if (originalPiExperimental === undefined) {
			delete process.env.KNIGHTCODE_EXPERIMENTAL;
		} else {
			process.env.KNIGHTCODE_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false for a forked package", () => {
		expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
	});
});
