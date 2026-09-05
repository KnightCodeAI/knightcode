import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "../../src/harness/context.ts";
import { resolveToolPath } from "../../src/harness/tools/path-utils.ts";
import type { ExecutionEnv } from "../../src/harness/types.ts";

/** Records what reaches absolutePath; the env's cwd decides whether it looks like Windows. */
function env(cwd: string): ExecutionEnv {
	return {
		cwd,
		absolutePath: async (path: string) => ({ ok: true as const, value: path }),
	} as unknown as ExecutionEnv;
}

describe("resolveToolPath drive mounts", () => {
	it.each([
		["/c/Users/dev/notes.md", "C:/Users/dev/notes.md"],
		["/mnt/d/repo/src", "D:/repo/src"],
		["/cygdrive/c/tmp", "C:/tmp"],
		// A bare mount root keeps its slash: `C:` alone is drive-relative on Windows.
		["/c", "C:/"],
		["/mnt/d", "D:/"],
		["/cygdrive/c", "C:/"],
		["C:/already/native", "C:/already/native"],
		["/usr/local/share", "/usr/local/share"],
		["/mnt/data/blob", "/mnt/data/blob"],
	])("rewrites %s to %s on a Windows env", async (input, expected) => {
		expect(await resolveToolPath(env("C:\\work\\repo"), input, BACKGROUND_CONTEXT)).toBe(expected);
	});

	it("leaves POSIX envs untouched", async () => {
		expect(await resolveToolPath(env("/home/dev/repo"), "/c/Users/dev/notes.md", BACKGROUND_CONTEXT)).toBe(
			"/c/Users/dev/notes.md",
		);
	});
});
