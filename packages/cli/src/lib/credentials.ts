import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { knightcodeHome } from "./paths";

export type SearchProvider = "brave" | "tavily";

function isSearchProvider(value: unknown): value is SearchProvider {
  return value === "brave" || value === "tavily";
}

export interface Credentials {
  openRouterApiKey?: string;
  searchProvider?: SearchProvider;
  searchApiKey?: string;
}

export function getCredentialsPath(): string {
  return join(knightcodeHome(), "credentials.json");
}

function read(): Credentials {
  try {
    return JSON.parse(
      readFileSync(getCredentialsPath(), "utf-8"),
    ) as Credentials;
  } catch {
    return {};
  }
}

function write(creds: Credentials): void {
  const dir = knightcodeHome();
  if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700, recursive: true });
  const path = getCredentialsPath();
  // 0600: owner-only — never world-readable secrets (POSIX; no-op on Windows).
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies when creating the file; re-harden an
  // existing file that may have looser permissions.
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

/** Resolved OpenRouter key; env override wins over the credentials file. */
export function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY ?? read().openRouterApiKey;
}

export function getSearchProvider(): SearchProvider | undefined {
  const env = process.env.KNIGHTCODE_SEARCH_PROVIDER;
  if (isSearchProvider(env)) return env;
  // Validate the persisted value too — malformed/arbitrary JSON on disk must
  // not yield an unexpected provider.
  const fromFile = read().searchProvider;
  return isSearchProvider(fromFile) ? fromFile : undefined;
}

export function getSearchApiKey(): string | undefined {
  return process.env.KNIGHTCODE_SEARCH_API_KEY ?? read().searchApiKey;
}

/** Merge-and-persist; omitted fields are left untouched. */
export function saveCredentials(patch: Credentials): void {
  write({ ...read(), ...patch });
}
