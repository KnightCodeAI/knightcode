import { tool } from "ai";
import { readFile, realpath, stat, open } from "fs/promises";
import { relative, resolve } from "path";
import { z } from "zod";
import { isPathInside, getCanonicalPath } from "../utils/path-security";

const MAX_FILE_SIZE = 10_000;

export function createReadFileTool(cwd: string) {
  return tool({
    description:
      "Read the contents of a file in the project. Returns the file text, truncated if very large.",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file to read"),
    }),
    execute: async ({ path }) => {
      const resolved = resolve(cwd, path);
      const rootReal = await getCanonicalPath(cwd);
      let targetReal: string;
      try {
        targetReal = await realpath(resolved);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to read file: ${message}` };
      }

      if (!isPathInside(rootReal, targetReal)) {
        return { error: "Path is outside the project directory" };
      }

      try {
        const fileInfo = await stat(targetReal);
        const totalLength = fileInfo.size;

        if (totalLength > MAX_FILE_SIZE) {
          const handle = await open(targetReal, "r");
          try {
            const buffer = Buffer.alloc(MAX_FILE_SIZE);
            const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_SIZE, 0);
            const content = buffer.toString("utf-8", 0, bytesRead);
            return {
              content,
              truncated: true,
              totalLength,
            };
          } finally {
            await handle.close();
          }
        }

        const content = await readFile(targetReal, "utf-8");
        return { content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to read file: ${message}` };
      }
    },
  });
}
