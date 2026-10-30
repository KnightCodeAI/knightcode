// Installing a plugin's npm dependencies (slice 7c §5, decision "Slice 7c's points" (3)): as coding-agent installs a
// package's dependencies, `npm install` in the plugin's real directory without dev dependencies, host peers or
// lifecycle scripts; the command overridable.

import { spawn } from "node:child_process";
import type { Context } from "../../context/index.ts";
import type { Plugin } from "./discover.ts";

/** What `installDependencies` takes besides the plugin: the npm command (`["npm"]` by default, e.g. `["pnpm"]`). */
export type InstallOptions = { readonly npmCommand?: readonly string[] };

/** The install's arguments: production dependencies only, no host peers, no scripts, no audit or funding notes. */
const INSTALL_ARGS = ["install", "--omit=dev", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund"];

/**
 * Installs `plugin`'s `dependencies` into its own `node_modules` (`npm install --omit=dev --legacy-peer-deps
 * --ignore-scripts --no-audit --no-fund` in its real directory). Rejects with the command's output when it fails, and
 * when `context` aborts (the command is killed, and the promise settles once it has exited).
 */
export async function installDependencies(
	plugin: Plugin,
	context: Context,
	options: InstallOptions = {},
): Promise<void> {
	const [command, ...prefix] = options.npmCommand ?? ["npm"];
	if (command === undefined) throw new Error("installDependencies: npmCommand is empty");
	context.abortSignal?.throwIfAborted();
	const child = spawn(command, [...prefix, ...INSTALL_ARGS], {
		cwd: plugin.dir,
		stdio: ["ignore", "pipe", "pipe"],
		signal: context.abortSignal,
	});
	let output = "";
	child.stdout.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		// An abort kills the command but reports before it has exited; until then it can still write `node_modules`, and
		// on Windows its working directory (the plugin's) stays locked.
		let aborted: Error | undefined;
		child.on("error", (error) => {
			if (error.name === "AbortError") aborted = error;
			else reject(error);
		});
		child.on("close", (exit) => (aborted === undefined ? resolve(exit) : reject(aborted)));
	});
	if (code !== 0) {
		throw new Error(`plugin "${plugin.name}": ${command} install failed (exit ${code}): ${output.trim()}`);
	}
}
