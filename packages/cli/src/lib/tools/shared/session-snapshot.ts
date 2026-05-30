import { existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, relative } from "path";

const sessionOriginalContents = new Map<string, Map<string, string | null>>();

export async function recordOriginalContent(
  sessionId: string,
  resolvedPath: string,
): Promise<void> {
  if (!sessionOriginalContents.has(sessionId)) {
    sessionOriginalContents.set(sessionId, new Map());
  }
  const sessionContents = sessionOriginalContents.get(sessionId)!;
  if (sessionContents.has(resolvedPath)) return;

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
  if (!sessionContents) return { revertedFiles, failedFiles };

  const cwd = process.cwd();

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

export function getSessionModifiedFiles(sessionId: string): string[] {
  const sessionContents = sessionOriginalContents.get(sessionId);
  if (!sessionContents) return [];
  const cwd = process.cwd();
  return Array.from(sessionContents.keys()).map((p) => relative(cwd, p));
}
