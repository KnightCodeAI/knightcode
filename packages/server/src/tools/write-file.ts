import { tool } from "ai";
import { mkdir, writeFile, realpath } from "fs/promises";
import { dirname, relative, resolve, basename } from "path";
import { z } from "zod";
import { isPathInside, getCanonicalPath } from "../utils/path-security";

export function createWriteFileTool(cwd: string) {
  return tool({
    description:
      "Create or overwrite a file in the project. Creates parent directories if they don't exist.",
    inputSchema: z.object({
      path: z.string().describe("Relative path to the file to write"),
      content: z.string().describe("The full content to write to the file"),
    }),
    execute: async ({ path, content }) => {
      const resolved = resolve(cwd, path);
      const rootReal = await getCanonicalPath(cwd);

      // Perform lexical boundary check first
      const relInitial = relative(rootReal, resolved);
      if (relInitial.startsWith("..") || relInitial.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
        return { error: "Path is outside the project directory" };
      }

      try {
        const parentDir = dirname(resolved);
        await mkdir(parentDir, { recursive: true });

        const parentReal = await realpath(parentDir);
        const targetReal = resolve(parentReal, basename(resolved));

        if (!isPathInside(rootReal, targetReal)) {
          return { error: "Path is outside the project directory" };
        }

        await writeFile(targetReal, content, "utf-8");

        return {
          success: true as const,
          path: relative(rootReal, targetReal),
          bytesWritten: Buffer.byteLength(content, "utf-8"),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to write file: ${message}` };
      }
    },
  });
}
