import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectSettingsDiagnostics, deduplicateDiagnostics } from "../src/core/settings-diagnostics.ts";
import { SettingsManager, type SettingsStorage } from "../src/core/settings-manager.ts";

describe("settings diagnostics", () => {
	it("includes the settings file path for file-backed storage", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "knightcode-settings-diagnostics-"));
		const agentDir = join(tempDir, "agent");
		const settingsPath = join(agentDir, "settings.json");
		mkdirSync(agentDir);
		writeFileSync(settingsPath, "{");

		try {
			const diagnostics = collectSettingsDiagnostics(SettingsManager.create(tempDir, agentDir));

			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0]?.type).toBe("warning");
			expect(diagnostics[0]?.message).toContain(`Invalid settings file ${settingsPath}:`);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * A reload re-reads the file, so the parse error it reported before is
	 * history. Keeping it would warn about a file that is now fine, forever,
	 * and would stack a fresh copy onto every reload of one that is not.
	 */
	it("drops a load error once the file it came from is repaired", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "knightcode-settings-reload-"));
		const agentDir = join(tempDir, "agent");
		const settingsPath = join(agentDir, "settings.json");
		mkdirSync(agentDir);
		writeFileSync(settingsPath, "{");

		try {
			const manager = SettingsManager.create(tempDir, agentDir);
			writeFileSync(settingsPath, JSON.stringify({ defaultModel: "repaired" }));
			await manager.reload();

			expect(collectSettingsDiagnostics(manager)).toEqual([]);
			expect(manager.getDefaultModel()).toBe("repaired");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	/**
	 * Untrusting the project stops reading its file, so its parse error no
	 * longer describes anything loaded — it must not survive to a later reload.
	 */
	it("drops a project load error once the project is no longer trusted", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "knightcode-settings-untrust-"));
		const agentDir = join(tempDir, "agent");
		mkdirSync(agentDir);
		mkdirSync(join(tempDir, ".knightcode"));
		writeFileSync(join(tempDir, ".knightcode", "settings.json"), "{");

		try {
			const manager = SettingsManager.create(tempDir, agentDir);
			manager.setProjectTrusted(false);
			await manager.reload();

			expect(collectSettingsDiagnostics(manager)).toEqual([]);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("falls back to the settings scope for storage without file paths", () => {
		const storage: SettingsStorage = {
			withLock(scope, fn) {
				if (scope === "global") throw new Error("backend failed");
				fn(undefined);
			},
		};
		const diagnostics = collectSettingsDiagnostics(SettingsManager.fromStorage(storage));

		expect(diagnostics).toEqual([{ type: "warning", message: "Invalid global settings: backend failed" }]);
	});

	it("deduplicates diagnostics by type and message", () => {
		const warning = { type: "warning" as const, message: "Invalid settings file /tmp/settings.json" };

		expect(deduplicateDiagnostics([warning, warning, { ...warning, type: "error" }])).toEqual([
			warning,
			{ ...warning, type: "error" },
		]);
	});
});
