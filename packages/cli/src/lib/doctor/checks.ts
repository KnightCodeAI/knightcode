import { spawnSync } from "node:child_process";
import { getOpenRouterApiKey } from "../credentials";
import { listSessions } from "../store";
import { getStore } from "../store/client";

export type CheckStatus = "ok" | "warn" | "fail";
export type DoctorCheck = {
  label: string;
  status: CheckStatus;
  detail?: string;
};

/**
 * Synchronous diagnostics shared by the /doctor dialog and the headless
 * `knightcode doctor` command. A missing API key is a warn (expected on a fresh
 * install), so it does not turn the headless exit code red.
 */
export function runDoctorChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // 1. OpenRouter API key
  if (getOpenRouterApiKey()) {
    checks.push({
      label: "OpenRouter API key",
      status: "ok",
      detail: "configured",
    });
  } else {
    checks.push({
      label: "OpenRouter API key",
      status: "warn",
      detail: "not configured (run: knightcode)",
    });
  }

  // 2. Local store
  try {
    listSessions(getStore(), process.cwd());
    checks.push({ label: "Local store", status: "ok", detail: "ready" });
  } catch (err) {
    checks.push({
      label: "Local store",
      status: "fail",
      detail: err instanceof Error ? err.message : "unavailable",
    });
  }

  // 3. Git available
  const git = spawnSync("git", ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (git.status === 0) {
    checks.push({
      label: "Git available",
      status: "ok",
      detail: git.stdout.trim(),
    });
  } else if (git.error && (git.error as { code?: string }).code === "ETIMEDOUT") {
    checks.push({
      label: "Git available",
      status: "warn",
      detail: "git check timed out",
    });
  } else {
    checks.push({
      label: "Git available",
      status: "warn",
      detail: "git not found in PATH",
    });
  }

  // 4. Runtime
  const runtime =
    typeof Bun !== "undefined"
      ? `Bun ${Bun.version}`
      : `Node ${process.version}`;
  checks.push({ label: "Runtime", status: "ok", detail: runtime });

  return checks;
}
