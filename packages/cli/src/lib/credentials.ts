import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { knightcodeHome } from "./paths";

export type SearchProvider = "brave" | "tavily";

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
  // 0600: owner-only — never world-readable secrets (POSIX; no-op on Windows).
  writeFileSync(getCredentialsPath(), JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

/** Resolved OpenRouter key; env override wins over the credentials file. */
export function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY ?? read().openRouterApiKey;
}

export function getSearchProvider(): SearchProvider | undefined {
  const env = process.env.KNIGHTCODE_SEARCH_PROVIDER;
  if (env === "brave" || env === "tavily") return env;
  return read().searchProvider;
}

export function getSearchApiKey(): string | undefined {
  return process.env.KNIGHTCODE_SEARCH_API_KEY ?? read().searchApiKey;
}

/** Merge-and-persist; omitted fields are left untouched. */
export function saveCredentials(patch: Credentials): void {
  write({ ...read(), ...patch });
}
