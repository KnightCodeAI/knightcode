import { tool } from "ai";
import { readdir, stat, realpath } from "fs/promises";
import { join, relative, resolve } from "path";
import { z } from "zod";
import { isPathInside, getCanonicalPath } from "../utils/path-security";

export function createListDirectoryTool(cwd: string) {
  return tool({
    description:
      "List files and directories in a project directory. Returns names with type indicators.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Relative path to the directory to list (defaults to project root)",
        )
        .default("."),
    }),
    execute: async ({ path }) => {
      const resolved = resolve(cwd, path);
      const rootReal = await getCanonicalPath(cwd);
      let targetReal = resolved;
      try {
        targetReal = await realpath(resolved);
      } catch {
        targetReal = resolve(rootReal, path);
      }

      if (!isPathInside(rootReal, targetReal)) {
        return { error: "Path is outside the project directory" };
      }

      try {
        const entries = await readdir(targetReal);
        const results: { name: string; type: "file" | "directory" }[] = [];

        for (const entry of entries) {
          // Skip hidden files and common large directories
          if (entry.startsWith(".") || entry === "node_modules") continue;

          try {
            const entryPath = join(targetReal, entry);
            const info = await stat(entryPath);
            results.push({
              name: entry,
              type: info.isDirectory() ? "directory" : "file",
            });
          } catch {
            // Skip entries we can't stat
          }
        }

        results.sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        return {
          path: relative(rootReal, targetReal) || ".",
          entries: results,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to list directory: ${message}` };
      }
    },
  });
}
