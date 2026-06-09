import { stat } from "fs/promises";
import { relative, resolve } from "path";
import { Glob, type KnightcodeTool } from "@repo/shared";
import {
  assertSafeProjectFile,
  isSafeProjectFile,
  resolveInsideRoot,
} from "../shared/path-resolution";
import { MAX_GLOB_RESULTS } from "../shared/constants";

export const tool: KnightcodeTool = Glob;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const { pattern, path } = Glob.input_schema.parse(input);
  const { cwd, resolved } = resolveInsideRoot(ctx.executionRoot, path ?? ".");
  assertSafeProjectFile(resolved, cwd, "read");

  const glob = new Bun.Glob(pattern);
  const filesWithMtime: { path: string; mtime: number }[] = [];
  let truncated = false;
  const start = Date.now();

  for await (const match of glob.scan({
    cwd: resolved,
    dot: false,
    onlyFiles: true,
  })) {
    const fileResolved = resolve(resolved, match);
    if (!isSafeProjectFile(fileResolved, cwd)) continue;
    if (match.includes("node_modules")) continue;
    if (filesWithMtime.length >= MAX_GLOB_RESULTS) {
      truncated = true;
      break;
    }
    try {
      const fStat = await stat(fileResolved);
      filesWithMtime.push({
        path: relative(cwd, fileResolved),
        mtime: fStat.mtimeMs,
      });
    } catch {
      filesWithMtime.push({ path: relative(cwd, fileResolved), mtime: 0 });
    }
  }

  filesWithMtime.sort((a, b) => {
    const timeDiff = b.mtime - a.mtime;
    return timeDiff !== 0 ? timeDiff : a.path.localeCompare(b.path);
  });

  const files = filesWithMtime.map((f) => f.path);
  return {
    files,
    numFiles: files.length,
    durationMs: Date.now() - start,
    ...(truncated ? { truncated: true } : {}),
  };
}
