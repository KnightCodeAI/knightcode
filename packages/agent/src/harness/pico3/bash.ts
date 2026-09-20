import { spawn } from "node:child_process";
import { Type } from "typebox";
import { getShellConfig } from "../env/nodejs.ts";
import type { ToolDeclaration, ToolResult } from "./types.ts";

const parameters = Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()) });

/** Run a shell command. Output is piped to the kernel; bounds come from `output`. */
export function bashTool(output: ToolDeclaration["output"] = {}): ToolDeclaration<typeof parameters> {
	return {
		name: "bash",
		description: "Run a shell command",
		parameters,
		replay: "unsafe",
		output,
		async execute({ command, cwd }, api, ctx): Promise<ToolResult> {
			const started = Date.now();
			// The shell is resolved the same way the execution environment resolves it, so this
			// runs under Git Bash on Windows rather than assuming `bash` is on PATH.
			const shell = await getShellConfig();
			if (!shell.ok) {
				api.stream(shell.error.message);
				return { isError: true, details: { exitCode: null, signal: null, ms: Date.now() - started } };
			}
			const fromStdin = shell.value.commandTransport === "stdin";
			const child = spawn(shell.value.shell, fromStdin ? shell.value.args : [...shell.value.args, command], {
				cwd,
				stdio: [fromStdin ? "pipe" : "ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			const onAbort = () => child.kill("SIGKILL");
			ctx.abortSignal?.addEventListener("abort", onAbort);
			child.stdout?.on("data", (c: Uint8Array) => api.stream(c));
			child.stderr?.on("data", (c: Uint8Array) => api.stream(c));
			if (fromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(command);
			}
			// A shell that cannot be spawned at all (missing binary, unusable cwd) emits `error`
			// and never `close`; without this the tool would wait forever.
			const { code, signal, error } = await new Promise<{
				code: number | null;
				signal: string | null;
				error?: Error;
			}>((resolve) => {
				child.once("error", (spawnError: Error) => resolve({ code: null, signal: null, error: spawnError }));
				child.once("close", (closeCode, closeSignal) => resolve({ code: closeCode, signal: closeSignal }));
			});
			ctx.abortSignal?.removeEventListener("abort", onAbort);
			if (error) api.stream(error.message);
			return {
				isError: error !== undefined || code !== 0,
				details: { exitCode: code, signal, ms: Date.now() - started },
			};
		},
	};
}
