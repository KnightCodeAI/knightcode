import { readUpdateCache, writeUpdateCache, type UpdateCache } from "./cache";

const REGISTRY_URL = "https://registry.npmjs.org/@knightcodeai/cli/latest";
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True if `latest` is strictly greater than `current` (semver major.minor.patch). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const ai = a[i as 0 | 1 | 2];
    const bi = b[i as 0 | 1 | 2];
    if (ai !== bi) return ai > bi;
  }
  return false;
}

/** Cached latest version if it is newer than `current`, else null. Never fetches. */
export function getAvailableUpdate(current: string): string | null {
  const cache = readUpdateCache();
  if (cache && isNewerVersion(cache.latestVersion, current)) {
    return cache.latestVersion;
  }
  return null;
}

/** Whether a background refresh should run, given the current cache and time. */
export function shouldRefresh(cache: UpdateCache | null, now: number): boolean {
  if (process.env.KNIGHTCODE_NO_UPDATE_CHECK) return false;
  if (cache && now - cache.lastChecked < TTL_MS) return false;
  return true;
}

let refreshedThisProcess = false;

/**
 * Fire-and-forget background refresh of the cache for the *next* launch. Never
 * blocks startup, never throws. Skipped when KNIGHTCODE_NO_UPDATE_CHECK is set,
 * when refreshed already this process, or when the cache is still fresh (<24h).
 */
export function maybeRefreshUpdateCache(): void {
  if (refreshedThisProcess) return;
  refreshedThisProcess = true;
  if (!shouldRefresh(readUpdateCache(), Date.now())) return;

  void (async () => {
    try {
      const res = await fetch(REGISTRY_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { version?: unknown };
      // Only cache a clean release version (X.Y.Z) — the registry is trusted,
      // but a malformed value would poison the cache the next launch reads.
      // (parseSemver itself stays prefix-tolerant so dev's "0.0.0-dev" current
      // version still compares for the banner.)
      if (typeof body.version === "string" && /^\d+\.\d+\.\d+$/.test(body.version)) {
        writeUpdateCache({
          lastChecked: Date.now(),
          latestVersion: body.version,
        });
      }
    } catch {
      // Offline / slow / malformed — stale cache is fine.
    }
  })();
}
