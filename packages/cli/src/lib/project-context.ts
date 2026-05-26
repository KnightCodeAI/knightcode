import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";

export interface ProjectContext {
  globalInstructions: string;
  projectInstructions: string;
}

export function loadProjectContextSync(cwd = process.cwd()): ProjectContext {
  const globalPath = join(homedir(), ".knightcode", "KNIGHTCODE.md");
  const localDir = cwd;
  const localPath = join(localDir, "KNIGHTCODE.md");

  let globalInstructions = "";
  let projectInstructions = "";

  try {
    if (existsSync(globalPath)) {
      globalInstructions = readFileSync(globalPath, "utf-8");
    }
  } catch (err) {
    // Ignore read errors, default to empty
  }

  try {
    if (existsSync(localPath)) {
      projectInstructions = readFileSync(localPath, "utf-8");
    }
  } catch (err) {
    // Ignore read errors, default to empty
  }

  return {
    globalInstructions,
    projectInstructions,
  };
}

export async function loadProjectContext(
  cwd = process.cwd(),
): Promise<ProjectContext> {
  const globalPath = join(homedir(), ".knightcode", "KNIGHTCODE.md");
  const localDir = cwd;
  const localPath = join(localDir, "KNIGHTCODE.md");

  let globalInstructions = "";
  let projectInstructions = "";

  try {
    if (existsSync(globalPath)) {
      globalInstructions = await readFile(globalPath, "utf-8");
    }
  } catch (err) {
    // Ignore read errors, default to empty
  }

  try {
    if (existsSync(localPath)) {
      projectInstructions = await readFile(localPath, "utf-8");
    }
  } catch (err) {
    // Ignore read errors, default to empty
  }

  return {
    globalInstructions,
    projectInstructions,
  };
}
