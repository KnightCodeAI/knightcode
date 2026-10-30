import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../src/core/trust-manager.ts";

describe("ProjectTrustStore", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `trust-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("stores decisions and inherits from parent directories", () => {
		const store = new ProjectTrustStore(agentDir);
		const parentDir = join(tempDir, "trusted-parent");
		const childDir = join(parentDir, "project");
		mkdirSync(childDir, { recursive: true });

		expect(store.get(childDir)).toBeNull();
		store.set(parentDir, true);
		expect(store.get(childDir)).toBe(true);
		store.set(childDir, false);
		expect(store.get(childDir)).toBe(false);
		store.set(childDir, null);
		expect(store.get(childDir)).toBe(true);
	});

	// Skipped on Windows: sets process.env.HOME, which os.homedir() ignores on Windows (it reads USERPROFILE).
	it.skipIf(process.platform === "win32")("detects trust-requiring project resources", () => {
		const originalHome = process.env.HOME;
		process.env.HOME = tempDir;
		try {
			mkdirSync(join(tempDir, ".knightcode", "agent"), { recursive: true });
			mkdirSync(join(tempDir, ".agents", "skills"), { recursive: true });
			expect(hasTrustRequiringProjectResources(tempDir)).toBe(false);
			expect(hasTrustRequiringProjectResources(cwd)).toBe(false);

			writeFileSync(join(tempDir, ".knightcode", "settings.json"), "{}");
			expect(hasTrustRequiringProjectResources(tempDir)).toBe(true);
			rmSync(join(tempDir, ".knightcode", "settings.json"), { force: true });

			mkdirSync(join(cwd, ".knightcode"), { recursive: true });
			writeFileSync(join(cwd, ".knightcode", "settings.json"), "{}");
			expect(hasTrustRequiringProjectResources(cwd)).toBe(true);

			rmSync(join(cwd, ".knightcode"), { recursive: true, force: true });
			mkdirSync(join(cwd, ".agents", "skills"), { recursive: true });
			expect(hasTrustRequiringProjectResources(cwd)).toBe(true);
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
		}
	});

	// Skipped on real Windows: the walk up from the temp dir reaches the actual ~/.agents/skills, which is not the
	// simulated HOME. The test simulates win32 itself, so Linux and macOS still cover the case folding.
	it.skipIf(process.platform === "win32")(
		"ignores the user .agents/skills dir when HOME differs only by case on Windows",
		() => {
			const originalHome = process.env.HOME;
			const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
			const mixedCaseHome = join(tempDir, "Home");
			const projectDir = join(mixedCaseHome, "project");
			mkdirSync(join(mixedCaseHome, ".agents", "skills"), { recursive: true });
			mkdirSync(projectDir, { recursive: true });
			process.env.HOME = mixedCaseHome.toLowerCase();
			Object.defineProperty(process, "platform", { value: "win32" });
			try {
				expect(hasTrustRequiringProjectResources(projectDir)).toBe(false);
			} finally {
				if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
				if (originalHome === undefined) {
					delete process.env.HOME;
				} else {
					process.env.HOME = originalHome;
				}
			}
		},
	);

	it("matches saved decisions regardless of casing on Windows", () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
		const projectDir = join(tempDir, "Project-Mixed");
		mkdirSync(projectDir, { recursive: true });
		const store = new ProjectTrustStore(agentDir);
		store.set(projectDir, true);
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			expect(store.get(projectDir.toLowerCase())).toBe(true);
			store.set(projectDir.toLowerCase(), false);
			const saved = JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf-8")) as Record<string, boolean>;
			expect(Object.values(saved)).toEqual([false]);
			expect(store.get(projectDir)).toBe(false);
		} finally {
			if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
		}
	});
});
