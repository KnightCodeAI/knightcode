import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveExperimentalSessionDirectory } from "../src/cli/experimental/runtime.ts";

// The resolved directory is built with join(), so its separator is platform-specific.
const AGENT_DIR = join(tmpdir(), "knightcode-agent-config");

afterEach(() => vi.unstubAllEnvs());

describe("experimental server session directory", () => {
	test("uses the experimental directory under the configured agent directory by default", () => {
		vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", AGENT_DIR);

		expect(resolveExperimentalSessionDirectory()).toBe(join(AGENT_DIR, "experimental", "sessions"));
	});

	test("resolves an explicit relative directory from the current working directory", () => {
		vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", AGENT_DIR);

		expect(resolveExperimentalSessionDirectory("relative/sessions")).toBe(resolve("relative/sessions"));
	});

	test("expands a tilde in an explicit directory", () => {
		expect(resolveExperimentalSessionDirectory("~/custom-sessions")).toBe(resolve(homedir(), "custom-sessions"));
	});
});
