/**
 * A GUI app on macOS and Linux does not inherit the login shell's PATH, so tools the agent runs
 * would be missing (desktop-shell.md section 5.1). Windows uses the process environment as is.
 */

import { execFile } from "node:child_process";

export function loginShellEnv(): Promise<NodeJS.ProcessEnv> {
	if (process.platform === "win32") return Promise.resolve(process.env);
	const shell = process.env.SHELL || "/bin/sh";
	return new Promise((resolve) => {
		execFile(shell, ["-ilc", "env -0"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
			if (error) return resolve(process.env);
			const env: NodeJS.ProcessEnv = {};
			for (const entry of stdout.split("\0")) {
				const eq = entry.indexOf("=");
				if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
			}
			resolve(env.PATH ? env : process.env);
		});
	});
}
