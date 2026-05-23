import { tool } from "ai";
import { z } from "zod";

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;

export function createBashTool(cwd: string) {
  return tool({
    description:
      "Execute a shell command in the project directory. Use this for running tests, builds, git operations, package installs, and any other shell commands.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
      timeout: z
        .number()
        .describe("Timeout in milliseconds (default: 30000)")
        .default(DEFAULT_TIMEOUT),
    }),
    execute: async ({ command, timeout }) => {
      try {
        const env: Record<string, string> = { TERM: "dumb" };
        const allowedKeys = ["PATH", "Path", "LANG", "HOME", "USER", "SHELL", "TEMP", "TMP", "PWD"];
        for (const key of allowedKeys) {
          if (process.env[key] !== undefined) {
            env[key] = process.env[key]!;
          }
        }

        const proc = Bun.spawn(["bash", "-c", command], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });

        const timer = setTimeout(() => {
          proc.kill();
        }, timeout);

        const stdoutChunks: Uint8Array[] = [];
        const stderrChunks: Uint8Array[] = [];
        let totalBytes = 0;
        let limitExceeded = false;

        const killProcess = () => {
          if (!limitExceeded) {
            limitExceeded = true;
            proc.kill();
          }
        };

        async function readStream(
          stream: ReadableStream<Uint8Array>,
          chunks: Uint8Array[]
        ): Promise<boolean> {
          const reader = stream.getReader();
          let truncated = false;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                if (totalBytes + value.byteLength > MAX_OUTPUT) {
                  const allowed = MAX_OUTPUT - totalBytes;
                  if (allowed > 0) {
                    chunks.push(value.slice(0, allowed));
                    totalBytes += allowed;
                  }
                  truncated = true;
                  killProcess();
                  break;
                }
                chunks.push(value);
                totalBytes += value.byteLength;
              }
            }
          } catch (e) {
            // Process killed
          } finally {
            reader.releaseLock();
          }
          return truncated;
        }

        const [stdoutTruncated, stderrTruncated] = await Promise.all([
          readStream(proc.stdout, stdoutChunks),
          readStream(proc.stderr, stderrChunks),
        ]);

        const exitCode = await proc.exited;
        clearTimeout(timer);

        const concatChunks = (chunks: Uint8Array[]) => {
          const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          return result;
        };

        const decoder = new TextDecoder();
        let stdoutText = decoder.decode(concatChunks(stdoutChunks));
        let stderrText = decoder.decode(concatChunks(stderrChunks));

        if (stdoutTruncated || (limitExceeded && stdoutText.length > 0)) {
          stdoutText += "\n... (truncated)";
        }
        if (stderrTruncated || (limitExceeded && stderrText.length > 0)) {
          stderrText += "\n... (truncated)";
        }

        return {
          stdout: stdoutText,
          stderr: stderrText,
          exitCode,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to execute command: ${message}` };
      }
    },
  });
}
