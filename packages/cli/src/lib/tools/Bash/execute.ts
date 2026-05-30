import { Bash, type KnightcodeTool } from "@knightcode/shared";
import {
  assertInteractiveCommandBlocked,
  assertSafeCommand,
} from "../shared/safe-command";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_OUTPUT,
  MAX_BASH_TIMEOUT_MS,
} from "../shared/constants";
import { truncate } from "../shared/truncate";
import { killProcessOnPort, registerProcess } from "../../tasks/background-tasks";
import { detectShell } from "../../shell";

export const tool: KnightcodeTool = Bash;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const parsed = Bash.input_schema.parse(input);
  const command = parsed.command;
  const requestedTimeout = parsed.timeout ?? DEFAULT_BASH_TIMEOUT_MS;
  const timeout = Math.min(requestedTimeout, MAX_BASH_TIMEOUT_MS);
  const run_in_background = parsed.run_in_background ?? false;
  const port = parsed.port;

  assertSafeCommand(command);
  assertInteractiveCommandBlocked(command);

  const shell = detectShell();
  const spawnArgs = [shell.bin, ...shell.args, command];

  if (run_in_background) {
    if (port !== undefined) {
      killProcessOnPort(port);
    }
    const proc = Bun.spawn(spawnArgs, {
      cwd: ctx.executionRoot,
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, TERM: "dumb" },
    });
    registerProcess(proc.pid, command, port, proc);
    return {
      success: true,
      pid: proc.pid,
      message: `Command started in the background (${shell.name}). PID: ${proc.pid}`,
    };
  }

  const proc = Bun.spawn(spawnArgs, {
    cwd: ctx.executionRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "dumb" },
  });
  const timer = setTimeout(() => proc.kill(), timeout);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  return {
    stdout: truncate(stdout, MAX_BASH_OUTPUT),
    stderr: truncate(stderr, MAX_BASH_OUTPUT),
    exitCode,
  };
}
