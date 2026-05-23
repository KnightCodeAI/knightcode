import { tool } from "ai";
import { relative, resolve } from "path";
import { z } from "zod";
import { isPathInside, getCanonicalPath } from "../utils/path-security";

const MAX_RESULTS = 200;

export function createGlobTool(cwd: string) {
  return tool({
    description:
      "Find files matching a glob pattern. Returns file paths relative to the project root. Skips node_modules and hidden directories.",
    inputSchema: z.object({
      pattern: z
        .string()
        .describe("Glob pattern to match (e.g. '**/*.ts', 'src/**/*.tsx')"),
      path: z
        .string()
        .describe("Relative directory to search in (defaults to project root)")
        .default("."),
    }),
    execute: async ({ pattern, path }) => {
      const resolved = resolve(cwd, path);
      const rootReal = await getCanonicalPath(cwd);
      const searchRoot = await getCanonicalPath(resolved);

      if (!isPathInside(rootReal, searchRoot)) {
        return { error: "Path is outside the project directory" };
      }

      try {
        const glob = new Bun.Glob(pattern);
        const files: string[] = [];
        let truncated = false;

        for await (const match of glob.scan({
          cwd: searchRoot,
          dot: false,
          onlyFiles: true,
        })) {
          // Skip node_modules matches
          if (match.includes("node_modules")) continue;

          if (files.length >= MAX_RESULTS) {
            truncated = true;
            break;
          }

          // Return paths relative to project root
          const absoluteMatch = resolve(searchRoot, match);
          const canonicalMatch = await getCanonicalPath(absoluteMatch);

          if (!isPathInside(rootReal, canonicalMatch)) {
            continue;
          }

          files.push(relative(rootReal, canonicalMatch));
        }

        files.sort();

        return {
          files,
          ...(truncated ? { truncated: true } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `Failed to execute command: ${message}` };
      }
    },
  });
}
