import { homedir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveSessionDirectory } from "../src/experimental/server.ts";

afterEach(() => vi.unstubAllEnvs());

// The experimental runtime binds a Unix domain socket and works in POSIX server
// directories, neither of which Windows provides (`listen EACCES`), as the server
// and client Unix suites already account for.
describe.skipIf(process.platform === "win32")("experimental server session directory", () => {
	test("uses the experimental directory under the configured agent directory by default", () => {
		vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", "/tmp/knightcode-agent-config");

		expect(resolveSessionDirectory()).toBe("/tmp/knightcode-agent-config/experimental/sessions");
	});

	test("resolves an explicit relative directory from the current working directory", () => {
		vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", "/tmp/knightcode-agent-config");

		expect(resolveSessionDirectory("relative/sessions")).toBe(resolve("relative/sessions"));
	});

	test("expands a tilde in an explicit directory", () => {
		expect(resolveSessionDirectory("~/custom-sessions")).toBe(resolve(homedir(), "custom-sessions"));
	});
});
