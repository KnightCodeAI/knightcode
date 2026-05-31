import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { spawnSync } from "child_process";
import { getOpenRouterApiKey } from "../../lib/credentials";
import { getStore } from "../../lib/store/client";
import { listSessions } from "../../lib/store";

type CheckStatus = "pending" | "ok" | "warn" | "fail";

type Check = {
  label: string;
  status: CheckStatus;
  detail?: string;
};

function statusColor(s: CheckStatus): string {
  switch (s) {
    case "ok":
      return "green";
    case "warn":
      return "yellow";
    case "fail":
      return "red";
    default:
      return "gray";
  }
}

function statusIcon(s: CheckStatus): string {
  switch (s) {
    case "ok":
      return "✓";
    case "warn":
      return "!";
    case "fail":
      return "✗";
    default:
      return "…";
  }
}

export function DoctorDialogContent() {
  const [checks, setChecks] = useState<Check[]>([
    { label: "OpenRouter API key", status: "pending" },
    { label: "Local store", status: "pending" },
    { label: "Git available", status: "pending" },
    { label: "Runtime", status: "pending" },
  ]);

  useEffect(() => {
    const update = (index: number, status: CheckStatus, detail?: string) => {
      setChecks((prev) =>
        prev.map((c, i) => (i === index ? { ...c, status, detail } : c)),
      );
    };

    // 1. OpenRouter API key
    if (getOpenRouterApiKey()) {
      update(0, "ok", "key present");
    } else {
      update(0, "fail", "set OPENROUTER_API_KEY or add it to credentials.json");
    }

    // 2. Local store
    try {
      listSessions(getStore(), process.cwd());
      update(1, "ok", "ready");
    } catch (err) {
      update(1, "fail", err instanceof Error ? err.message : "unavailable");
    }

    // 3. Git available
    const git = spawnSync("git", ["--version"], { encoding: "utf-8" });
    if (git.status === 0) {
      update(2, "ok", git.stdout.trim());
    } else {
      update(2, "warn", "git not found in PATH");
    }

    // 4. Runtime
    const runtime =
      typeof Bun !== "undefined"
        ? `Bun ${(globalThis as any).Bun.version}`
        : `Node ${process.version}`;
    update(3, "ok", runtime);
  }, []);

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.BOLD}>Knightcode diagnostics</text>
      {checks.map((check) => (
        <box key={check.label} flexDirection="row" gap={2}>
          <text fg={statusColor(check.status)}>{statusIcon(check.status)}</text>
          <box width={22} flexShrink={0}>
            <text>{check.label}</text>
          </box>
          {check.detail && (
            <text attributes={TextAttributes.DIM}>{check.detail}</text>
          )}
        </box>
      ))}
    </box>
  );
}
