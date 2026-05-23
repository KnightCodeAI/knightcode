import { tool } from "ai";
import { relative, resolve, isAbsolute } from "path";
import { z } from "zod";
import { isPathInside, getCanonicalPath } from "../utils/path-security";

const MAX_MATCHES = 50;
const MAX_OUTPUT_BYTES = 20_000;

function parseGrepLine(line: string): { file: string; line: number; content: string } | null {
  // Find ':(\d+):' skipping drive letter prefix on Windows (start search at index 2)
  const match = line.slice(2).match(/:(\d+):/);
  if (!match) return null;

  const colonIndex = line.indexOf(`:${match[1]}:`, 2);
  if (colonIndex === -1) return null;

  const file = line.substring(0, colonIndex);
  const lineNumber = parseInt(match[1]!, 10);
  const content = line.substring(colonIndex + match[1]!.length + 2);

  return { file, line: lineNumber, content };
}

export function createGrepTool(cwd: string) {
  return tool({
    description:
      "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers. Skips hidden directories, node_modules, and binary files.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      path: z
        .string()
        .describe("Relative directory to search in (defaults to project root)")
        .default("."),
      include: z
        .string()
        .describe("Glob pattern to filter files (e.g. '*.ts', '*.tsx')")
        .optional(),
    }),
    execute: async ({ pattern, path, include }) => {
      const resolved = resolve(cwd, path);
      const rootReal = await getCanonicalPath(cwd);
      const searchRoot = await getCanonicalPath(resolved);

      if (!isPathInside(rootReal, searchRoot)) {
        return { error: "Path is outside the project directory" };
      }

      try {
        const args = [
          "-rn",
          "--color=never",
          "--exclude-dir=node_modules",
          "--exclude-dir=.git",
          "-E",
        ];

        if (include) {
          args.push(`--include=${include}`);
        }

        args.push(pattern, searchRoot);

        const proc = Bun.spawn(["grep", ...args], {
          stdout: "pipe",
          stderr: "pipe",
          cwd,
        });

        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let totalBytes = 0;
        let truncated = false;
        const matches: { file: string; line: number; content: string }[] = [];

        const killProcess = () => {
          try {
            proc.kill();
          } catch {}
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer) {
                const lines = buffer.split("\n");
                for (const line of lines) {
                  if (line.trim()) {
                    if (matches.length >= MAX_MATCHES) {
                      truncated = true;
                      killProcess();
                      break;
                    }
                    const parsed = parseGrepLine(line);
                    if (parsed) {
                      matches.push({
                        file: relative(rootReal, parsed.file),
                        line: parsed.line,
                        content: parsed.content,
                      });
                    }
                  }
                }
              }
              break;
            }

            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes >= MAX_OUTPUT_BYTES) {
                truncated = true;
                killProcess();
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              let hitLimit = false;
              for (const line of lines) {
                if (matches.length >= MAX_MATCHES) {
                  truncated = true;
                  killProcess();
                  hitLimit = true;
                  break;
                }
                const parsed = parseGrepLine(line);
                if (parsed) {
                  matches.push({
                    file: relative(rootReal, parsed.file),
                    line: parsed.line,
                    content: parsed.content,
                  });
                }
              }
              if (hitLimit) break;
            }
          }
        } catch (e) {
          // Process killed
        } finally {
          reader.releaseLock();
        }

        const stderr = await new Response(proc.stderr).text();
        await proc.exited;

        // grep exits with 1 when no matches found — not an error
        if (proc.exitCode !== 0 && proc.exitCode !== 1) {
          return { error: `grep failed: ${stderr.trim()}` };
        }

        if (matches.length === 0) {
          return { matches: [], message: "No matches found" };
        }

        return {
          matches,
          ...(truncated ? { truncated: true } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to execute command: ${message}` };
      }
    },
  });
}
