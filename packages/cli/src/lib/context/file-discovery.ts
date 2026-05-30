import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, extname, isAbsolute, join, parse, resolve } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Text file extensions allowed for @include directives
// Prevents binary files (images, PDFs, etc.) from being loaded into memory
// ---------------------------------------------------------------------------
export const TEXT_FILE_EXTENSIONS = new Set([
  // Markdown and text
  ".md",
  ".txt",
  ".text",
  // Data formats
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  // Web
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  // JavaScript/TypeScript
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  // Python
  ".py",
  ".pyi",
  ".pyw",
  // Ruby
  ".rb",
  ".erb",
  ".rake",
  // Go
  ".go",
  // Rust
  ".rs",
  // Java/Kotlin/Scala
  ".java",
  ".kt",
  ".kts",
  ".scala",
  // C/C++
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".hxx",
  // C#
  ".cs",
  // Swift
  ".swift",
  // Shell
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  // Config
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".config",
  ".properties",
  // Database
  ".sql",
  ".graphql",
  ".gql",
  // Protocol
  ".proto",
  // Frontend frameworks
  ".vue",
  ".svelte",
  ".astro",
  // Templating
  ".ejs",
  ".hbs",
  ".pug",
  ".jade",
  // Other languages
  ".php",
  ".pl",
  ".pm",
  ".lua",
  ".r",
  ".R",
  ".dart",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".cljc",
  ".edn",
  ".hs",
  ".lhs",
  ".elm",
  ".ml",
  ".mli",
  ".f",
  ".f90",
  ".f95",
  ".for",
  // Build files
  ".cmake",
  ".make",
  ".makefile",
  ".gradle",
  ".sbt",
  // Documentation
  ".rst",
  ".adoc",
  ".asciidoc",
  ".org",
  ".tex",
  ".latex",
  // Lock files
  ".lock",
  // Misc
  ".log",
  ".diff",
  ".patch",
]);

// ---------------------------------------------------------------------------
// Git root detection
// ---------------------------------------------------------------------------

/**
 * Find the nearest git repository root by walking upward from `cwd`.
 * Returns null if not inside a git repo.
 */
export function findGitRoot(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return resolve(result.stdout.trim());
}

// ---------------------------------------------------------------------------
// Hierarchical directory traversal
// ---------------------------------------------------------------------------

/**
 * Traverses from `cwd` upward to the git root (or home directory if not in
 * a git repo), collecting all `.knightcode/<subdir>` directories that exist.
 *
 * Returns paths from most specific (closest to cwd) to least specific.
 * Stops at git root to prevent leaking parent-project configs.
 * Never includes the home directory itself (loaded separately as "global").
 */
export function getProjectDirsUpToRoot(subdir: string, cwd: string): string[] {
  const home = resolve(homedir());
  const gitRoot = findGitRoot(cwd);
  let current = resolve(cwd);
  const dirs: string[] = [];

  while (true) {
    // Don't include home — it's loaded separately as "global"
    if (normalizePath(current) === normalizePath(home)) break;

    const knightcodeSubdir = join(current, ".knightcode", subdir);
    try {
      if (
        existsSync(knightcodeSubdir) &&
        statSync(knightcodeSubdir).isDirectory()
      ) {
        dirs.push(knightcodeSubdir);
      }
    } catch {
      // skip inaccessible dirs
    }

    // Stop after processing the git root
    if (gitRoot && normalizePath(current) === normalizePath(gitRoot)) break;

    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  return dirs;
}

/**
 * Normalize path for cross-platform comparison (lowercase on Windows).
 */
function normalizePath(p: string): string {
  const normalized = resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

// ---------------------------------------------------------------------------
// HTML comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip block-level HTML comments (<!-- ... -->) from markdown content.
 *
 * Only strips comments that appear on their own lines (block-level).
 * Comments inside fenced code blocks are preserved.
 * Unclosed comments are left in place.
 */
export function stripHtmlComments(content: string): {
  content: string;
  stripped: boolean;
} {
  if (!content.includes("<!--")) {
    return { content, stripped: false };
  }

  const lines = content.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let inComment = false;
  let stripped = false;

  for (const line of lines) {
    // Track fenced code blocks
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (inComment) {
      // Look for closing -->
      const closeIdx = line.indexOf("-->");
      if (closeIdx !== -1) {
        inComment = false;
        stripped = true;
        // Keep any content after the closing tag
        const after = line.slice(closeIdx + 3).trim();
        if (after) result.push(after);
      }
      // Else: still inside comment, skip line
      continue;
    }

    // Check for opening <!--
    const trimmed = line.trimStart();
    if (trimmed.startsWith("<!--")) {
      const closeIdx = trimmed.indexOf("-->", 4);
      if (closeIdx !== -1) {
        // Single-line comment
        stripped = true;
        const before = line.slice(0, line.indexOf("<!--")).trimEnd();
        const after = trimmed.slice(closeIdx + 3).trim();
        const remainder = [before, after].filter(Boolean).join(" ");
        if (remainder) result.push(remainder);
      } else {
        // Multi-line comment starts
        inComment = true;
        stripped = true;
        const before = line.slice(0, line.indexOf("<!--")).trimEnd();
        if (before) result.push(before);
      }
    } else {
      result.push(line);
    }
  }

  return { content: result.join("\n"), stripped };
}

// ---------------------------------------------------------------------------
// @include directive resolution
// ---------------------------------------------------------------------------

/**
 * Expand a path that may start with `~/` to an absolute path.
 */
function expandPath(p: string, basePath: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(2));
  }
  if (isAbsolute(p)) return p;
  return resolve(basePath, p);
}

/**
 * Extract @include paths from markdown content.
 * Skips paths inside fenced code blocks and inline code spans.
 *
 * Supports: @path, @./relative, @~/home, @/absolute
 */
export function resolveIncludePaths(
  content: string,
  basePath: string,
): string[] {
  const absolutePaths = new Set<string>();
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Remove inline code spans to avoid matching @paths inside them
    const cleaned = line.replace(/`[^`]*`/g, "");

    const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
    let match;
    while ((match = includeRegex.exec(cleaned)) !== null) {
      let path = match[1];
      if (!path) continue;

      // Strip fragment identifiers (#heading)
      const hashIndex = path.indexOf("#");
      if (hashIndex !== -1) path = path.substring(0, hashIndex);
      if (!path) continue;

      // Unescape spaces
      path = path.replace(/\\ /g, " ");

      // Validate path format
      const isValidPath =
        path.startsWith("./") ||
        path.startsWith("~/") ||
        (path.startsWith("/") && path !== "/") ||
        (!path.startsWith("@") &&
          !path.match(/^[#%^&*()]+/) &&
          path.match(/^[a-zA-Z0-9._-]/));

      if (isValidPath) {
        absolutePaths.add(expandPath(path, basePath));
      }
    }
  }

  return [...absolutePaths];
}

// ---------------------------------------------------------------------------
// Recursive file inclusion
// ---------------------------------------------------------------------------

const MAX_INCLUDE_DEPTH = 5;

/**
 * Recursively read a file and its @include references, concatenating content.
 * Prevents circular references via the processedPaths set.
 * Only allows text file extensions.
 *
 * Returns the concatenated content (main file first, then includes).
 */
export function processFileWithIncludes(
  filePath: string,
  processedPaths: Set<string> = new Set(),
  depth: number = 0,
): string {
  const normalizedPath = normalizePath(filePath);
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {
    return "";
  }

  // Skip non-text files
  const ext = extname(filePath).toLowerCase();
  if (ext && !TEXT_FILE_EXTENSIONS.has(ext)) {
    return "";
  }

  processedPaths.add(normalizedPath);

  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }

  if (!rawContent.trim()) return "";

  // Strip HTML comments
  const { content: strippedContent } = stripHtmlComments(rawContent);

  // Resolve include paths
  const includePaths = resolveIncludePaths(strippedContent, dirname(filePath));

  // Start with the main file content
  const parts: string[] = [strippedContent];

  // Recursively process includes
  for (const includePath of includePaths) {
    const included = processFileWithIncludes(
      includePath,
      processedPaths,
      depth + 1,
    );
    if (included) parts.push(included);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * List all .md files in a directory (non-recursive).
 */
export function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/**
 * Recursively list all .md files in a directory and its subdirectories.
 */
export function listMarkdownFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          results.push(...listMarkdownFilesRecursive(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          results.push(fullPath);
        }
      } catch {
        // skip inaccessible entries
      }
    }
  } catch {
    // skip inaccessible directories
  }

  return results;
}
