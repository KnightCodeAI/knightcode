import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { knightcodeHome } from "../paths";

export type UpdateCache = { lastChecked: number; latestVersion: string };

export function getUpdateCachePath(): string {
  return join(knightcodeHome(), "update-check.json");
}

export function readUpdateCache(): UpdateCache | null {
  try {
    const raw = JSON.parse(readFileSync(getUpdateCachePath(), "utf-8")) as unknown;
    if (
      raw &&
      typeof raw === "object" &&
      typeof (raw as UpdateCache).lastChecked === "number" &&
      typeof (raw as UpdateCache).latestVersion === "string"
    ) {
      return raw as UpdateCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeUpdateCache(cache: UpdateCache): void {
  const dir = knightcodeHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(getUpdateCachePath(), JSON.stringify(cache, null, 2), "utf-8");
}
