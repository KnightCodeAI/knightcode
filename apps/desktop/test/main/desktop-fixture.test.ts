/** The parity fixture must never inherit the developer's credentials or configuration. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopFixture } from "../fixtures/desktop.ts";

const roots: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("desktop parity fixture", () => {
	it("isolates all configuration roots and does not forward provider credentials", () => {
		vi.stubEnv("OPENAI_API_KEY", "must-not-reach-electron");
		vi.stubEnv("ANTHROPIC_API_KEY", "must-not-reach-server");
		vi.stubEnv("NODE_OPTIONS", "--require=untrusted");
		const fixture = createDesktopFixture({ theme: "light" });
		roots.push(fixture.root);
		for (const key of [
			"HOME",
			"USERPROFILE",
			"APPDATA",
			"LOCALAPPDATA",
			"XDG_CONFIG_HOME",
			"XDG_CACHE_HOME",
			"XDG_DATA_HOME",
			"CLAUDE_CONFIG_DIR",
			"GROK_HOME",
			"GH_CONFIG_DIR",
			"KNIGHTCODE_CODING_AGENT_DIR",
		]) {
			expect(fixture.env[key].startsWith(fixture.root)).toBe(true);
			expect(existsSync(fixture.env[key])).toBe(true);
		}
		expect(fixture.env.OPENAI_API_KEY).toBeUndefined();
		expect(fixture.env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(fixture.env.NODE_OPTIONS).toBeUndefined();
		expect(fixture.env.KNIGHTCODE_OFFLINE).toBe("1");
		expect(fixture.env.GIT_CONFIG_NOSYSTEM).toBe("1");
	});

	// PR #598: on Linux, Git and gh can share /usr/bin.
	it.skipIf(process.platform === "win32")("keeps tools on PATH when they share a directory with gh", () => {
		const tools = createDesktopFixture({ theme: "light" });
		roots.push(tools.root);
		const bin = join(tools.root, "tools");
		mkdirSync(bin);
		writeFileSync(join(bin, "fixture-tool"), "#!/bin/sh\necho fixture tool\n", { mode: 0o755 });
		writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		vi.stubEnv("PATH", bin);
		const fixture = createDesktopFixture({ theme: "light" });
		roots.push(fixture.root);
		const result = spawnSync("fixture-tool", [], { env: fixture.env, encoding: "utf8" });
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe("fixture tool");
	});

	it("puts the project where no ancestor holds the developer's skills or context files", () => {
		const fixture = createDesktopFixture({ theme: "light" });
		roots.push(fixture.root);
		const found: string[] = [];
		for (let dir = dirname(fixture.project); ; dir = dirname(dir)) {
			for (const entry of [join(".agents", "skills"), join(".claude", "skills"), "AGENTS.md", "CLAUDE.md"]) {
				if (existsSync(join(dir, entry))) found.push(join(dir, entry));
			}
			if (dirname(dir) === dir) break;
		}
		expect(found).toEqual([]);
	});

	it("writes the faux model selection and deterministic desktop preferences", () => {
		const fixture = createDesktopFixture({ theme: "dark" });
		roots.push(fixture.root);
		expect(JSON.parse(readFileSync(join(fixture.agentDir, "settings.json"), "utf8"))).toEqual({
			defaultProvider: "faux-e2e",
			defaultModel: "faux-e2e",
		});
		const state = JSON.parse(readFileSync(join(fixture.userData, "desktop-state.json"), "utf8"));
		expect(state.projects).toEqual([{ path: fixture.project, name: "Parity project", collapsed: false }]);
		expect(state.preferences).toMatchObject({
			theme: "dark",
			uiFontSize: 14,
			codeFontSize: 12,
			turnNotifications: "never",
		});
		expect(state.preferences.appearance.dark).toEqual({
			font: "Arial",
			contentFont: "Arial",
			codeFont: "Courier New",
			translucentSidebar: false,
		});
		expect(state.preferences.appearance.light).toEqual(state.preferences.appearance.dark);
		expect(readFileSync(join(fixture.project, "README.md"), "utf8")).toBe(
			"# Parity project\n\nA deterministic desktop fixture.\n",
		);
	});

	it("creates independent fixtures and leaves project trust undecided", () => {
		const first = createDesktopFixture({ theme: "light", projectSettings: true });
		const second = createDesktopFixture({ theme: "light" });
		roots.push(first.root, second.root);
		expect(first.root).not.toBe(second.root);
		expect(existsSync(join(first.project, ".knightcode", "settings.json"))).toBe(true);
		expect(existsSync(join(second.project, ".knightcode"))).toBe(false);
		expect(existsSync(join(first.agentDir, "trust.json"))).toBe(false);
	});
});
