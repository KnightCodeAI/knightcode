import { describe, expect, it } from "vitest";
import { execCommand } from "../src/core/exec.ts";

describe("execCommand", () => {
	it("reports spawn errors in stderr", async () => {
		const result = await execCommand("knightcode-command-that-does-not-exist", [], process.cwd());

		expect(result).toMatchObject({
			code: 1,
			killed: false,
			stdout: "",
		});
		expect(result.stderr).toMatch(/ENOENT/);
	});

	it("keeps stderr empty when a command exits silently", async () => {
		const result = await execCommand(process.execPath, ["-e", "process.exit(1)"], process.cwd());

		expect(result).toEqual({ stdout: "", stderr: "", code: 1, killed: false });
	});
});
