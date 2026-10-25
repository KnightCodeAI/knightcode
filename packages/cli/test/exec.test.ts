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

	it("decodes a multi-byte character split across stdout and stderr chunks", async () => {
		const script = [
			'const text = Buffer.from("你好");',
			"process.stdout.write(text.subarray(0, 1));",
			"process.stderr.write(text.subarray(0, 1));",
			"setTimeout(() => {",
			"  process.stdout.write(text.subarray(1));",
			"  process.stderr.write(text.subarray(1));",
			"}, 50);",
		].join("\n");
		const result = await execCommand(process.execPath, ["-e", script], process.cwd());

		expect(result).toEqual({ stdout: "你好", stderr: "你好", code: 0, killed: false });
	});
});
