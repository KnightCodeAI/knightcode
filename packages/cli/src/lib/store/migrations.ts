import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Migration = { id: string; hash: string; sql: string };

/**
 * Read every `.sql` file under `migrations/`, sorted by filename, hashing each.
 * Used in dev (and tests). The compiled binary uses the embedded array instead.
 */
export function readMigrationsFromDisk(
  dir: string = join(dirname(fileURLToPath(import.meta.url)), "migrations"),
): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), "utf-8");
      return {
        id: file.replace(/\.sql$/, ""),
        hash: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    });
}

/**
 * The migrations to apply. In the compiled binary `KNIGHTCODE_MIGRATIONS` is
 * substituted with the embedded array; in dev it is an undeclared global, so the
 * `typeof` guard takes the disk path.
 */
export function loadMigrations(): Migration[] {
  if (typeof KNIGHTCODE_MIGRATIONS !== "undefined") {
    return KNIGHTCODE_MIGRATIONS;
  }
  return readMigrationsFromDisk();
}
