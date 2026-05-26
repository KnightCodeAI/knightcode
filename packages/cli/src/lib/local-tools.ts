import { Mode, toolInputSchemas, type ModeType } from "@knightcode/shared";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, stat, writeFile, unlink } from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { spawnSync } from "child_process";
import safeRegex from "safe-regex";
import { apiClient } from "./api-client";
import { killProcessOnPort, registerProcess } from "./background-tasks";
import { getExecutionRoot } from "./worktree-tools";

const sessionOriginalContents = new Map<string, Map<string, string | null>>();

function isSafeRegex(pattern: string): boolean {
  return safeRegex(pattern);
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateAndGetRegex(pattern: string, flags: string): RegExp {
  if (!isSafeRegex(pattern)) {
    return new RegExp(escapeRegExp(pattern), flags);
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    return new RegExp(escapeRegExp(pattern), flags);
  }
}

async function recordOriginalContent(sessionId: string, resolvedPath: string) {
  if (!sessionOriginalContents.has(sessionId)) {
    sessionOriginalContents.set(sessionId, new Map());
  }
  const sessionContents = sessionOriginalContents.get(sessionId)!;
  if (sessionContents.has(resolvedPath)) {
    return;
  }
  if (existsSync(resolvedPath)) {
    try {
      const content = await readFile(resolvedPath, "utf-8");
      sessionContents.set(resolvedPath, content);
    } catch {
      // ignore
    }
  } else {
    sessionContents.set(resolvedPath, null);
  }
}

export async function undoSessionChanges(sessionId: string): Promise<{
  revertedFiles: string[];
  failedFiles: string[];
}> {
  const revertedFiles: string[] = [];
  const failedFiles: string[] = [];

  const sessionContents = sessionOriginalContents.get(sessionId);
  if (!sessionContents) {
    return { revertedFiles, failedFiles };
  }
  const cwd = getExecutionRoot(sessionId).root;

  for (const [resolvedPath, originalContent] of sessionContents.entries()) {
    try {
      const relPath = relative(cwd, resolvedPath);
      if (originalContent === null) {
        if (existsSync(resolvedPath)) {
          await unlink(resolvedPath);
        }
      } else {
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, originalContent, "utf-8");
      }
      revertedFiles.push(relPath);
      sessionContents.delete(resolvedPath);
    } catch {
      const relPath = relative(cwd, resolvedPath);
      failedFiles.push(relPath);
    }
  }

  if (sessionContents.size === 0) {
    sessionOriginalContents.delete(sessionId);
  }

  return { revertedFiles, failedFiles };
}

const MAX_FILE_SIZE = 100_000;
const MAX_RESULTS = 500;
const MAX_MATCHES = 200;
const MAX_OUTPUT = 50_000;
const DEFAULT_TIMEOUT = 120_000;

function resolveInsideRoot(root: string, path: string) {
  const resolved = resolve(root, path);
  const rel = relative(root, resolved);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside the project directory");
  }

  return { cwd: root, resolved };
}

function assertSafeProjectFile(resolved: string, cwd: string, action: string) {
  const rel = relative(cwd, resolved);
  const parts = rel.split(/[\\/]+/);
  const fileName = basename(resolved).toLowerCase();

  if (parts.includes(".git")) {
    throw new Error(`Refusing to ${action} files inside .git`);
  }

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    throw new Error(`Refusing to ${action} environment/secret files`);
  }
}

function assertSafeCommand(command: string) {
  const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();
  const forbiddenPatterns = [
    /\brm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\b/,
    /\bgit\s+push\b.*\s--force(?:\s|$)/,
    /\bdrop\s+table\b/,
    /^format\b/,
    /\bdeltree\b/,
    /\bdel\s+\/[^\s]*s[^\s]*q\b/,
    /\bremove-item\b.*\s-recurse\b.*\s-force\b/,
  ];

  if (forbiddenPatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error("Refusing to run a destructive command");
  }
}

function truncate(value: string, limit: number) {
  return value.length > limit
    ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
    : value;
}

export async function executeLocalTool(
  toolName: string,
  input: unknown,
  mode: ModeType,
  sessionId?: string,
) {
  const sId = sessionId ?? "default";
  const executionRoot = getExecutionRoot(sId).root;
  if (
    mode === Mode.PLAN &&
    ![
      "readFile",
      "listDirectory",
      "glob",
      "grep",
      "webSearch",
      "webFetch",
      "todoWrite",
      "AskUserQuestion",
      "gitStatus",
      "gitDiff",
      "gitLog",
    ].includes(toolName)
  ) {
    throw new Error(`Tool ${toolName} is not available in PLAN mode`);
  }

  switch (toolName) {
    case "readFile": {
      const { path, offset, limit } = toolInputSchemas.readFile.parse(input);
      const { cwd, resolved } = resolveInsideRoot(executionRoot, path);
      assertSafeProjectFile(resolved, cwd, "read");

      const ext = path.split(".").pop()?.toLowerCase();
      const imageExtensions = [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "ico",
        "svg",
      ];
      if (ext && imageExtensions.includes(ext)) {
        const buffer = await readFile(resolved);
        const mimeType =
          ext === "svg"
            ? "image/svg+xml"
            : ext === "ico"
              ? "image/x-icon"
              : `image/${ext === "jpg" ? "jpeg" : ext}`;
        return {
          content: buffer.toString("base64"),
          isImage: true,
          mimeType,
          totalLength: buffer.length,
        };
      }

      const raw = await readFile(resolved, "utf-8");

      // Paginated line-based reading
      if (offset !== undefined || limit !== undefined) {
        const lines = raw.split("\n");
        const start = offset ?? 0;
        const count = limit ?? 200;
        const sliced = lines.slice(start, start + count);
        return {
          content: sliced.join("\n"),
          totalLines: lines.length,
          offset: start,
          linesReturned: sliced.length,
          truncated: start + count < lines.length,
        };
      }

      return raw.length > MAX_FILE_SIZE
        ? {
            content: raw.slice(0, MAX_FILE_SIZE),
            truncated: true,
            totalLength: raw.length,
          }
        : { content: raw };
    }
    case "listDirectory": {
      const { path } = toolInputSchemas.listDirectory.parse(input);
      const { cwd, resolved } = resolveInsideRoot(executionRoot, path);
      const entries = await readdir(resolved);
      const results: { name: string; type: "file" | "directory" }[] = [];

      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const info = await stat(join(resolved, entry));
        results.push({
          name: entry,
          type: info.isDirectory() ? "directory" : "file",
        });
      }

      results.sort((a, b) =>
        a.type !== b.type
          ? a.type === "directory"
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
      return { path: relative(cwd, resolved) || ".", entries: results };
    }
    case "glob": {
      const { pattern, path } = toolInputSchemas.glob.parse(input);
      const { cwd, resolved } = resolveInsideRoot(executionRoot, path);
      const glob = new Bun.Glob(pattern);
      const files: string[] = [];
      let truncated = false;

      for await (const match of glob.scan({
        cwd: resolved,
        dot: false,
        onlyFiles: true,
      })) {
        if (match.includes("node_modules")) continue;
        if (files.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        files.push(relative(cwd, resolve(resolved, match)));
      }

      files.sort();
      return { files, ...(truncated ? { truncated: true } : {}) };
    }
    case "grep": {
      const {
        pattern,
        path,
        include,
        caseInsensitive,
        contextLines,
        outputMode = "content",
        maxResults = 200,
      } = toolInputSchemas.grep.parse(input);
      const { cwd, resolved } = resolveInsideRoot(executionRoot, path);

      const regex = validateAndGetRegex(pattern, caseInsensitive ? "i" : "");

      // Check if resolved path is a directory or a file
      const stats = await stat(resolved);
      const filesToSearch: string[] = [];

      if (stats.isDirectory()) {
        const globPattern = include ?? "**/*";
        const glob = new Bun.Glob(globPattern);

        for await (const match of glob.scan({
          cwd: resolved,
          dot: false,
          onlyFiles: true,
        })) {
          const isIgnored =
            match.includes("node_modules") ||
            match.includes(".git") ||
            match.includes(".knightcode");
          if (isIgnored) continue;
          filesToSearch.push(resolve(resolved, match));
        }
      } else {
        filesToSearch.push(resolved);
      }

      // Sort files to be deterministic
      filesToSearch.sort();

      const results: any[] = [];
      let truncated = false;
      const limit = Math.min(maxResults, MAX_MATCHES);

      for (const absPath of filesToSearch) {
        if (results.length >= limit) {
          truncated = true;
          break;
        }

        let content: string;
        try {
          content = await readFile(absPath, "utf-8");
          // Simple binary file check: contains null character
          if (content.includes("\0")) continue;
        } catch {
          continue;
        }

        const relativePath = relative(cwd, absPath);

        if (outputMode === "files") {
          regex.lastIndex = 0;
          if (regex.test(content)) {
            results.push({ file: relativePath });
          }
        } else if (outputMode === "count") {
          const globalRegex = validateAndGetRegex(
            pattern,
            caseInsensitive ? "gi" : "g",
          );
          const matches = content.match(globalRegex);
          if (matches && matches.length > 0) {
            results.push({ file: relativePath, count: matches.length });
          }
        } else {
          // Content mode
          const lines = content.split("\n");
          const matchIndices: number[] = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            regex.lastIndex = 0;
            if (regex.test(line)) {
              matchIndices.push(i);
            }
          }

          if (matchIndices.length === 0) continue;

          // If no context lines are requested, just return match lines
          if (contextLines === undefined || contextLines <= 0) {
            for (const idx of matchIndices) {
              if (results.length >= limit) {
                truncated = true;
                break;
              }
              results.push({
                file: relativePath,
                line: idx + 1,
                type: "match" as const,
                content: lines[idx]!,
              });
            }
          } else {
            // With context lines - return unique lines in chronological order
            const includedLines = new Set<number>();
            for (const idx of matchIndices) {
              const start = Math.max(0, idx - contextLines);
              const end = Math.min(lines.length - 1, idx + contextLines);
              for (let i = start; i <= end; i++) {
                includedLines.add(i);
              }
            }

            const sortedIncluded = Array.from(includedLines).sort(
              (a, b) => a - b,
            );
            for (const idx of sortedIncluded) {
              if (results.length >= limit) {
                truncated = true;
                break;
              }
              const isMatch = matchIndices.includes(idx);
              results.push({
                file: relativePath,
                line: idx + 1,
                type: isMatch ? ("match" as const) : ("context" as const),
                content: lines[idx]!,
              });
            }
          }
        }
      }

      return {
        outputMode,
        results,
        ...(truncated ? { truncated: true } : {}),
      };
    }
    case "writeFile": {
      const { path, content } = toolInputSchemas.writeFile.parse(input);
      const { cwd, resolved } = resolveInsideRoot(executionRoot, path);
      assertSafeProjectFile(resolved, cwd, "modify");
      await recordOriginalContent(sId, resolved);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return {
        success: true as const,
        path: relative(cwd, resolved),
        bytesWritten: Buffer.byteLength(content, "utf-8"),
      };
    }
    case "editFile": {
      const { path, oldString, newString, replaceAll } =
        toolInputSchemas.editFile.parse(input);
      const { cwd, resolved } = resolveInsideRoot(executionRoot, path);
      assertSafeProjectFile(resolved, cwd, "modify");
      await recordOriginalContent(sId, resolved);
      const content = await readFile(resolved, "utf-8");
      const occurrences = content.split(oldString).length - 1;

      if (occurrences === 0) throw new Error("oldString not found in file");
      if (occurrences > 1 && !replaceAll)
        throw new Error(
          `oldString is ambiguous; found ${occurrences} matches. Use replaceAll: true to replace all.`,
        );

      const updated = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);

      await writeFile(resolved, updated, "utf-8");
      return {
        success: true as const,
        path: relative(cwd, resolved),
        replacements: replaceAll ? occurrences : 1,
      };
    }
    case "bash": {
      const {
        command,
        timeout = DEFAULT_TIMEOUT,
        runInBackground = false,
        port,
      } = toolInputSchemas.bash.parse(input);
      assertSafeCommand(command);

      const isWin = process.platform === "win32";
      const shellArgs = isWin
        ? ["powershell.exe", "-Command", command]
        : ["bash", "-c", command];

      if (runInBackground) {
        if (port !== undefined) {
          killProcessOnPort(port);
        }

        const proc = Bun.spawn(shellArgs, {
          cwd: executionRoot,
          stdout: "ignore",
          stderr: "ignore",
          env: { ...process.env, TERM: "dumb" },
        });

        registerProcess(proc.pid, command, port, proc);

        return {
          success: true,
          pid: proc.pid,
          message: `Command started in the background. PID: ${proc.pid}`,
        };
      }

      const proc = Bun.spawn(shellArgs, {
        cwd: executionRoot,
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
        stdout: truncate(stdout, MAX_OUTPUT),
        stderr: truncate(stderr, MAX_OUTPUT),
        exitCode,
      };
    }
    case "webSearch": {
      const { query, maxResults } = toolInputSchemas.webSearch.parse(input);
      const res = await apiClient.web.search.$post({
        json: { query, maxResults },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Web search failed: ${text}`);
      }
      return await res.json();
    }
    case "webFetch": {
      const { url, maxLength } = toolInputSchemas.webFetch.parse(input);
      const res = await apiClient.web.fetch.$post({
        json: { url, maxLength },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Web fetch failed: ${text}`);
      }
      return await res.json();
    }
    case "gitStatus": {
      const res = spawnSync("git", ["status", "--short"], {
        cwd: executionRoot,
        encoding: "utf-8",
      });
      return {
        status: res.stdout || res.stderr || "",
        exitCode: res.status,
      };
    }
    case "gitDiff": {
      const { path: diffPath } = toolInputSchemas.gitDiff.parse(input);
      const args = ["diff"];
      if (diffPath) {
        const { cwd, resolved } = resolveInsideRoot(executionRoot, diffPath);
        args.push("--", relative(cwd, resolved));
      }
      const res = spawnSync("git", args, {
        cwd: executionRoot,
        encoding: "utf-8",
      });
      return {
        diff: res.stdout || res.stderr || "",
        exitCode: res.status,
      };
    }
    case "gitLog": {
      const { limit } = toolInputSchemas.gitLog.parse(input);
      const res = spawnSync("git", ["log", `-${limit}`, "--oneline"], {
        cwd: executionRoot,
        encoding: "utf-8",
      });
      return {
        log: res.stdout || res.stderr || "",
        exitCode: res.status,
      };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export function getSessionModifiedFiles(sessionId: string): string[] {
  const sessionContents = sessionOriginalContents.get(sessionId);
  if (!sessionContents) return [];
  const cwd = getExecutionRoot(sessionId).root;
  return Array.from(sessionContents.keys()).map((p) => relative(cwd, p));
}
