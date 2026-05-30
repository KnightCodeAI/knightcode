import {
  lstatSync,
  readlinkSync,
  realpathSync,
} from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";

export function resolveInsideRoot(
  root: string,
  path: string,
  isWrite = false,
): { cwd: string; resolved: string } {
  const resolved = resolve(root, path);

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = resolve(root);
  }

  let realResolved = resolved;
  try {
    realResolved = realpathSync(resolved);
  } catch {
    let parent = dirname(resolved);
    while (parent && parent !== resolved) {
      try {
        const realParent = realpathSync(parent);
        realResolved = join(realParent, relative(parent, resolved));
        break;
      } catch {
        const nextParent = dirname(parent);
        if (nextParent === parent) {
          realResolved = resolved;
          break;
        }
        parent = nextParent;
      }
    }
    if (!realResolved) {
      realResolved = resolved;
    }
  }

  const rel = relative(realRoot, realResolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside the project directory");
  }

  if (isWrite) {
    let current = resolved;
    while (
      current &&
      current.length >= root.length &&
      current !== dirname(current)
    ) {
      try {
        const stats = lstatSync(current);
        if (stats.isSymbolicLink()) {
          const linkTarget = readlinkSync(current);
          const resolvedTarget = resolve(dirname(current), linkTarget);
          const linkRel = relative(realRoot, resolvedTarget);
          if (linkRel.startsWith("..") || isAbsolute(linkRel)) {
            throw new Error(
              "Parent symlink points outside the project directory",
            );
          }
        }
      } catch (err: any) {
        if (err.message?.includes("outside the project directory")) {
          throw err;
        }
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return { cwd: root, resolved };
}

export function assertSafeProjectFile(
  resolved: string,
  cwd: string,
  action: string,
): void {
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

export function isSafeProjectFile(resolved: string, cwd: string): boolean {
  try {
    assertSafeProjectFile(resolved, cwd, "read");
    return true;
  } catch {
    return false;
  }
}
