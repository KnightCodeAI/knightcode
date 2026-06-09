import { open, readFile, stat } from "fs/promises";
import { relative, resolve } from "path";
import { Grep, type KnightcodeTool } from "@repo/shared";
import {
  assertSafeProjectFile,
  isSafeProjectFile,
  resolveInsideRoot,
} from "../shared/path-resolution";
import { validateAndGetRegex } from "../shared/safe-regex";
import { DEFAULT_GREP_HEAD_LIMIT } from "../shared/constants";

const VCS_DIRECTORIES = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];

const TYPE_MAP: Record<string, string> = {
  js: "**/*.js",
  ts: "**/*.ts",
  tsx: "**/*.tsx",
  jsx: "**/*.jsx",
  py: "**/*.py",
  go: "**/*.go",
  rs: "**/*.rs",
  rust: "**/*.rs",
  java: "**/*.java",
  rb: "**/*.rb",
  ruby: "**/*.rb",
  c: "**/*.c",
  cpp: "**/*.cpp",
  h: "**/*.h",
  hpp: "**/*.hpp",
  css: "**/*.css",
  html: "**/*.html",
  json: "**/*.json",
  yaml: "**/*.{yaml,yml}",
  yml: "**/*.{yaml,yml}",
  md: "**/*.md",
  toml: "**/*.toml",
  xml: "**/*.xml",
  sql: "**/*.sql",
  sh: "**/*.sh",
  bash: "**/*.{sh,bash}",
  swift: "**/*.swift",
  kt: "**/*.kt",
  scala: "**/*.scala",
  php: "**/*.php",
  lua: "**/*.lua",
  zig: "**/*.zig",
};

export const tool: KnightcodeTool = Grep;

export async function execute(
  input: unknown,
  ctx: { executionRoot: string },
): Promise<unknown> {
  const parsed = Grep.input_schema.parse(input);
  const pattern = parsed.pattern;
  const path = parsed.path ?? ".";
  const include = parsed.glob;
  const fileType = parsed.type;
  const caseInsensitive = parsed["-i"] ?? false;
  const ctxBoth = parsed["-C"] ?? parsed.context;
  const ctxBefore = parsed["-B"];
  const ctxAfter = parsed["-A"];
  const outputMode = parsed.output_mode;
  const headLimit = parsed.head_limit ?? DEFAULT_GREP_HEAD_LIMIT;
  const grepOffset = parsed.offset ?? 0;
  const multiline = parsed.multiline ?? false;

  const { cwd, resolved } = resolveInsideRoot(ctx.executionRoot, path);
  assertSafeProjectFile(resolved, cwd, "read");

  const effectiveCtxBefore = ctxBoth ?? ctxBefore;
  const effectiveCtxAfter = ctxBoth ?? ctxAfter;

  let regexFlags = caseInsensitive ? "i" : "";
  if (multiline) regexFlags += "s";
  const regex = validateAndGetRegex(pattern, regexFlags);

  const stats = await stat(resolved);
  const filesToSearch: string[] = [];

  if (stats.isDirectory()) {
    let globPattern = "**/*";
    if (include) {
      globPattern = include;
    } else if (fileType) {
      globPattern = TYPE_MAP[fileType] ?? `**/*.${fileType}`;
    }

    const glob = new Bun.Glob(globPattern);
    for await (const match of glob.scan({
      cwd: resolved,
      dot: false,
      onlyFiles: true,
    })) {
      const fileResolved = resolve(resolved, match);
      if (!isSafeProjectFile(fileResolved, cwd)) continue;
      const isIgnored =
        match.includes("node_modules") ||
        match.includes(".knightcode") ||
        VCS_DIRECTORIES.some((d) => match.includes(d));
      if (isIgnored) continue;
      filesToSearch.push(fileResolved);
    }
  } else {
    filesToSearch.push(resolved);
  }
  filesToSearch.sort();

  const results: any[] = [];
  let truncated = false;
  const effectiveLimit = headLimit === 0 ? Infinity : headLimit;
  const batchSize = 30;

  for (let i = 0; i < filesToSearch.length; i += batchSize) {
    if (results.length >= effectiveLimit + grepOffset) {
      truncated = true;
      break;
    }
    const batch = filesToSearch.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (absPath) => {
        try {
          const fStat = await stat(absPath);
          if (fStat.size > 500_000) return null;

          const fd = await open(absPath, "r");
          try {
            const buf = Buffer.alloc(1024);
            const { bytesRead } = await fd.read(buf, 0, 1024, 0);
            if (buf.subarray(0, bytesRead).includes(0)) return null;
          } finally {
            await fd.close();
          }

          const content = await readFile(absPath, "utf-8");
          const relativePath = relative(cwd, absPath);
          const fileMatches: any[] = [];

          if (outputMode === "files_with_matches") {
            regex.lastIndex = 0;
            if (regex.test(content)) fileMatches.push({ file: relativePath });
          } else if (outputMode === "count") {
            const globalRegex = validateAndGetRegex(
              pattern,
              caseInsensitive ? "gi" : "g",
            );
            const matches = content.match(globalRegex);
            if (matches && matches.length > 0) {
              fileMatches.push({ file: relativePath, count: matches.length });
            }
          } else {
            const lines = content.split("\n");
            const matchIndices: number[] = [];
            for (let li = 0; li < lines.length; li++) {
              regex.lastIndex = 0;
              if (regex.test(lines[li]!)) matchIndices.push(li);
            }

            if (matchIndices.length > 0) {
              const hasContext =
                (effectiveCtxBefore !== undefined && effectiveCtxBefore > 0) ||
                (effectiveCtxAfter !== undefined && effectiveCtxAfter > 0);

              if (!hasContext) {
                for (const idx of matchIndices) {
                  fileMatches.push({
                    file: relativePath,
                    line: idx + 1,
                    type: "match" as const,
                    content: lines[idx]!,
                  });
                }
              } else {
                const cb = effectiveCtxBefore ?? 0;
                const ca = effectiveCtxAfter ?? 0;
                const included = new Set<number>();
                for (const idx of matchIndices) {
                  const startI = Math.max(0, idx - cb);
                  const endI = Math.min(lines.length - 1, idx + ca);
                  for (let i2 = startI; i2 <= endI; i2++) included.add(i2);
                }
                const sorted = Array.from(included).sort((a, b) => a - b);
                for (const idx of sorted) {
                  const isMatch = matchIndices.includes(idx);
                  fileMatches.push({
                    file: relativePath,
                    line: idx + 1,
                    type: isMatch ? ("match" as const) : ("context" as const),
                    content: lines[idx]!,
                  });
                }
              }
            }
          }
          return fileMatches;
        } catch {
          return null;
        }
      }),
    );

    for (const fileMatches of batchResults) {
      if (fileMatches) {
        for (const match of fileMatches) results.push(match);
      }
    }
  }

  const paginatedResults = results.slice(
    grepOffset,
    headLimit === 0 ? undefined : grepOffset + effectiveLimit,
  );
  truncated =
    results.length > grepOffset + (headLimit === 0 ? Infinity : effectiveLimit);

  return {
    outputMode,
    results: paginatedResults,
    numResults: paginatedResults.length,
    ...(truncated ? { truncated: true } : {}),
    ...(grepOffset > 0 ? { appliedOffset: grepOffset } : {}),
    ...(truncated ? { appliedLimit: headLimit } : {}),
  };
}
