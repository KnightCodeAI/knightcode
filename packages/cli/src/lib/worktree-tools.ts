import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative, resolve } from "path";

export type WorktreeRecord = {
  sessionId: string;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  baseHead: string;
  createdAt: string;
  lastUsedAt: string;
  status: "active" | "missing" | "removed";
};

export type WorktreeRegistry = {
  version: 1;
  records: Record<string, WorktreeRecord>;
};

export type ExecutionRoot = {
  root: string;
  isolated: boolean;
  repoRoot?: string;
  branchName?: string;
  worktreePath?: string;
  reason?: string;
};

const REGISTRY_VERSION = 1 as const;
const DISABLE_WORKTREES_ENV = "KNIGHTCODE_DISABLE_WORKTREES";

function runGit(args: string[], cwd: string) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
  });
}

function safeSessionId(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  return safe || "default";
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function getRegistryPath(repoRoot: string) {
  return join(repoRoot, ".knightcode", "worktrees.json");
}

function getConfigPath(repoRoot: string) {
  return join(repoRoot, ".knightcode", "config.json");
}

export function isWorktreeDisabled(repoRoot: string): boolean {
  if (process.env[DISABLE_WORKTREES_ENV] === "1") {
    return true;
  }
  const configPath = getConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return true;
  }
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config.disableWorktrees !== false;
  } catch {
    return true;
  }
}

export function setWorktreeDisabled(repoRoot: string, disabled: boolean): void {
  const configPath = getConfigPath(repoRoot);
  ensureDir(dirname(configPath));
  try {
    let config: Record<string, any> = {};
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    }
    config.disableWorktrees = disabled;
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {}
}

function getWorktreesDir(repoRoot: string) {
  return join(repoRoot, ".knightcode", "worktrees");
}

function loadRegistry(repoRoot: string): WorktreeRegistry {
  const path = getRegistryPath(repoRoot);
  if (!existsSync(path)) {
    return { version: REGISTRY_VERSION, records: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as WorktreeRegistry;
    if (parsed?.version === REGISTRY_VERSION && parsed.records) {
      return parsed;
    }
  } catch {
    // Fall through to a clean registry if the local file was corrupted.
  }

  return { version: REGISTRY_VERSION, records: {} };
}

function saveRegistry(repoRoot: string, registry: WorktreeRegistry) {
  const path = getRegistryPath(repoRoot);
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(registry, null, 2), "utf-8");
}

export function isGitRepo(cwd = process.cwd()): boolean {
  const result = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.status === 0 && result.stdout.trim() === "true";
}

export function getRepoRoot(cwd = process.cwd()): string | null {
  const result = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (result.status !== 0) return null;
  return resolve(result.stdout.trim());
}

function getHead(repoRoot: string): string {
  const result = runGit(["rev-parse", "HEAD"], repoRoot);
  if (result.status !== 0) {
    throw new Error(
      `Failed to resolve git HEAD: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function branchExists(repoRoot: string, branchName: string): boolean {
  const result = runGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
    repoRoot,
  );
  return result.status === 0;
}

function linkNodeModules(repoRoot: string, worktreePath: string) {
  const source = join(repoRoot, "node_modules");
  const target = join(worktreePath, "node_modules");
  if (!existsSync(source) || existsSync(target)) return;

  try {
    symlinkSync(source, target, "junction");
  } catch {
    // Dependency linking is an optimization; isolation still works without it.
  }
}

function createWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
  baseHead: string,
) {
  ensureDir(dirname(worktreePath));
  const args = branchExists(repoRoot, branchName)
    ? ["worktree", "add", worktreePath, branchName]
    : ["worktree", "add", "-b", branchName, worktreePath, baseHead];

  const result = runGit(args, repoRoot);
  if (result.status !== 0) {
    throw new Error(
      `Failed to create git worktree for Knightcode session: ${
        result.stderr || result.stdout
      }`,
    );
  }

  linkNodeModules(repoRoot, worktreePath);
}

export function getOrCreateSessionWorktree(
  sessionId: string,
  cwd = process.cwd(),
): ExecutionRoot {
  if (process.env[DISABLE_WORKTREES_ENV] === "1") {
    return {
      root: cwd,
      isolated: false,
      reason: "Worktrees disabled by environment",
    };
  }

  if (!sessionId) {
    return { root: cwd, isolated: false, reason: "No session id" };
  }

  if (!isGitRepo(cwd)) {
    return { root: cwd, isolated: false, reason: "Not a git repository" };
  }

  const repoRoot = getRepoRoot(cwd);
  if (!repoRoot) {
    return {
      root: cwd,
      isolated: false,
      reason: "Unable to resolve repo root",
    };
  }

  if (isWorktreeDisabled(repoRoot)) {
    return {
      root: repoRoot,
      isolated: false,
      reason: "Worktrees disabled by configuration",
    };
  }

  const safeId = safeSessionId(sessionId);
  const now = new Date().toISOString();
  const registry = loadRegistry(repoRoot);
  const existing = registry.records[sessionId];

  if (existing?.status === "active" && existsSync(existing.worktreePath)) {
    existing.lastUsedAt = now;
    saveRegistry(repoRoot, registry);
    return {
      root: existing.worktreePath,
      isolated: true,
      repoRoot,
      branchName: existing.branchName,
      worktreePath: existing.worktreePath,
    };
  }

  const baseHead = getHead(repoRoot);
  const branchName = existing?.branchName ?? `knightcode/session-${safeId}`;
  const worktreePath =
    existing?.worktreePath ?? join(getWorktreesDir(repoRoot), safeId);

  if (!existsSync(worktreePath)) {
    createWorktree(repoRoot, worktreePath, branchName, baseHead);
  }

  registry.records[sessionId] = {
    sessionId,
    repoRoot,
    worktreePath,
    branchName,
    baseHead: existing?.baseHead ?? baseHead,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
    status: "active",
  };
  saveRegistry(repoRoot, registry);

  return {
    root: worktreePath,
    isolated: true,
    repoRoot,
    branchName,
    worktreePath,
  };
}

export function getExecutionRoot(sessionId?: string, cwd = process.cwd()) {
  if (!sessionId) {
    return { root: cwd, isolated: false, reason: "No session id" };
  }
  return getOrCreateSessionWorktree(sessionId, cwd);
}

export function getWorktreeStatus(
  sessionId: string,
  cwd = process.cwd(),
): WorktreeRecord | null {
  const repoRoot = getRepoRoot(cwd);
  if (!repoRoot) return null;
  const registry = loadRegistry(repoRoot);
  const record = registry.records[sessionId];
  if (!record) return null;
  return {
    ...record,
    status: existsSync(record.worktreePath) ? record.status : "missing",
  };
}

export function formatRootForDisplay(root: string, cwd = process.cwd()) {
  const rel = relative(cwd, root);
  return rel && !rel.startsWith("..") ? rel : root;
}
