import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vitest";
import { type SpawnPty, Terminals } from "../../src/main/terminals.ts";

// One real shell through node-pty, the default shell of the platform: CI sets KNIGHTCODE_REAL_PTY on Windows and
// Linux (ci.yml) and on macOS (desktop-release.yml), where node-pty's binary for the runner is installed.
test.runIf(process.env.KNIGHTCODE_REAL_PTY === "1")(
	"the default shell runs a command through node-pty",
	async () => {
		let output = "";
		const terminals = new Terminals({
			platform: process.platform,
			env: process.env,
			spawn: () => (createRequire(import.meta.url)("node-pty") as { spawn: SpawnPty }).spawn,
			post: (_windowId, event) => {
				if (event.event === "terminal/data") output += event.data;
			},
		});
		const { terminalId } = terminals.create({ threadId: "t", cwd: tmpdir(), cols: 80, rows: 24 }, 1);
		try {
			// The shell joins kc- and "pty": the line typed (echoed back) never has the result in it.
			terminals.write(terminalId, 'echo kc-"pty"\r');
			await vi.waitFor(() => expect(output).toContain("kc-pty"), { timeout: 20_000, interval: 100 });
		} finally {
			terminals.killAll();
		}
	},
	30_000,
);
