import { basename, dirname, isAbsolute, relative, resolve } from "path";
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
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const parent = await realpath(dirname(p));
      return resolve(parent, basename(p));
    }
    throw error;
  }
}
