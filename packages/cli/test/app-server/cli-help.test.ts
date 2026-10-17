import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { printHelp } from "../../src/cli/args.ts";

test("general CLI help discovers the app-server subcommand", () => {
	const output = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		printHelp();
		expect(output.mock.calls.flat().join("\n")).toContain("app-server");
	} finally {
		output.mockRestore();
	}
});

test.each(["--help", "-h"])(
	"app-server %s exits without starting a connection or polluting protocol stdout",
	(flag) => {
		const child = spawnSync("bun", [resolve(import.meta.dirname, "../../src/cli.ts"), "app-server", flag], {
			encoding: "utf8",
			timeout: 20_000,
		});
		expect(child.error).toBeUndefined();
		expect(child.status).toBe(0);
		expect(child.stdout).toBe("");
		expect(child.stderr).toContain("knightcode app-server");
		expect(child.stderr).toContain("--session-dir");
		expect(child.stderr).toContain("--extension");
	},
	30_000,
);
