import { spawnProcess, waitForChildProcess } from "./child-process.ts";
import { killProcessTree } from "./shell.ts";

/** Exit codes the background update worker reports to the session that spawned it. */
export const UPDATE_EXIT_LOCKED = 75;
export const UPDATE_EXIT_UNSUPPORTED = 78;

/** Longest a package manager step may run; a stalled npm otherwise holds the update lock forever. */
export const UPDATE_STEP_TIMEOUT_MS = 10 * 60 * 1000;

/** Capture updater output so npm and launchers cannot write into the active TUI. */
export async function runUpdateProcess(
	command: string,
	args: string[],
	options: { cwd?: string; signal?: AbortSignal; quiet?: boolean } = {},
): Promise<string> {
	options.signal?.throwIfAborted();
	const child = spawnProcess(command, args, {
		cwd: options.cwd,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	// spawn's own `signal` kills only the direct child, which on Windows is the
	// cmd.exe wrapper around npm.cmd; npm itself would keep running.
	const abort = () => {
		if (child.pid) killProcessTree(child.pid);
	};
	options.signal?.addEventListener("abort", abort, { once: true });
	// Under Node, a pipe that errors (EPIPE after a forced kill) with no listener
	// throws; the exit code already reports the failure.
	child.stdout.on("error", () => {});
	child.stderr.on("error", () => {});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout = (stdout + chunk.toString()).slice(-8192);
		if (!options.quiet) process.stdout.write(chunk);
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString()).slice(-8192);
		if (!options.quiet) process.stderr.write(chunk);
	});
	let code: number | null;
	try {
		code = await waitForChildProcess(child);
	} finally {
		options.signal?.removeEventListener("abort", abort);
	}
	options.signal?.throwIfAborted();
	if (code !== 0) {
		throw new Error(`${command} exited with code ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
	}
	return stdout.trim();
}
