import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";

import {
  findGitRoot,
  processFileWithIncludes,
  stripHtmlComments,
} from "./file-discovery";

export interface ProjectContext {
  globalInstructions: string;
  projectInstructions: string;
  localInstructions: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readIfExistsSync(p: string): string {
  try {
    return existsSync(p) ? readFileSync(p, "utf-8") : "";
  } catch {
    return "";
  }
}

function normalizePath(p: string): string {
  const n = resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/**
 * Walk from CWD upward to git root (or filesystem root), collecting
 * directories in root-first order (root → CWD).
 */
function getDirectoriesUpward(cwd: string): string[] {
  const home = resolve(homedir());
  const gitRoot = findGitRoot(cwd);
  let current = resolve(cwd);
  const dirs: string[] = [];

  while (true) {
    // Stop at home directory (global is loaded separately)
    if (normalizePath(current) === normalizePath(home)) break;

    dirs.push(current);

    // Stop after processing git root
    if (gitRoot && normalizePath(current) === normalizePath(gitRoot)) break;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Reverse so root comes first → CWD last (highest priority)
  return dirs.reverse();
}

// ---------------------------------------------------------------------------
// Sync loading with upward traversal
// ---------------------------------------------------------------------------

/**
 * Process a single instruction file: read, strip HTML comments, resolve
 * @include directives.
 */
function processInstructionFileSync(
  filePath: string,
  processedPaths: Set<string>,
): string {
  if (!existsSync(filePath)) return "";
  try {
    return processFileWithIncludes(filePath, processedPaths);
  } catch {
    return readIfExistsSync(filePath);
  }
}

export function loadProjectContextSync(cwd = process.cwd()): ProjectContext {
  const processedPaths = new Set<string>();

  // 1. Global instructions: ~/.knightcode/KNIGHTCODE.md
  const globalPath = join(homedir(), ".knightcode", "KNIGHTCODE.md");
  const globalInstructions = processInstructionFileSync(
    globalPath,
    processedPaths,
  );

  // 2. Project instructions: walk upward from CWD to git root
  //    Check KNIGHTCODE.md and .knightcode/KNIGHTCODE.md at each level
  //    Root-first ordering means closest-to-CWD has highest priority (loaded last)
  const dirs = getDirectoriesUpward(cwd);
  const projectParts: string[] = [];

  for (const dir of dirs) {
    // KNIGHTCODE.md at directory root
    const projectPath = join(dir, "KNIGHTCODE.md");
    const content = processInstructionFileSync(projectPath, processedPaths);
    if (content.trim()) projectParts.push(content);

    // .knightcode/KNIGHTCODE.md
    const dotKnightcodePath = join(dir, ".knightcode", "KNIGHTCODE.md");
    const dotContent = processInstructionFileSync(
      dotKnightcodePath,
      processedPaths,
    );
    if (dotContent.trim()) projectParts.push(dotContent);
  }

  // 3. Local instructions: walk upward from CWD to git root
  //    KNIGHTCODE.local.md at each level
  const localParts: string[] = [];

  for (const dir of dirs) {
    const localPath = join(dir, "KNIGHTCODE.local.md");
    const content = processInstructionFileSync(localPath, processedPaths);
    if (content.trim()) localParts.push(content);
  }

  return {
    globalInstructions: globalInstructions.trim(),
    projectInstructions: projectParts.join("\n\n").trim(),
    localInstructions: localParts.join("\n\n").trim(),
  };
}

// ---------------------------------------------------------------------------
// Async loading with upward traversal
// ---------------------------------------------------------------------------

export async function loadProjectContext(
  cwd = process.cwd(),
): Promise<ProjectContext> {
  // The sync version is already fast enough for the small number of files
  // involved. Delegate to it to avoid duplicating the traversal logic.
  return loadProjectContextSync(cwd);
}
