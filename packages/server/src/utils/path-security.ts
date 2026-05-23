import { relative, resolve, isAbsolute } from "path";
import { realpath } from "fs/promises";

export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);

  return (
    rel !== ".." &&
    !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(rel)
  );
}

export async function getCanonicalPath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return resolve(p);
  }
}
