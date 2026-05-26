import { spawnSync } from "child_process";

export interface GitContext {
  branchName: string;
  status: string;
  diffSummary: string;
}

export function loadGitContext(cwd = process.cwd()): GitContext {
  const branchResult = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf-8",
  });
  const branchName =
    branchResult.status === 0 ? branchResult.stdout.trim() : "unknown";

  const statusResult = spawnSync("git", ["status", "--short"], {
    cwd,
    encoding: "utf-8",
  });
  const status = statusResult.status === 0 ? statusResult.stdout.trim() : "";

  const diffResult = spawnSync("git", ["diff", "--stat"], {
    cwd,
    encoding: "utf-8",
  });
  const diffSummary = diffResult.status === 0 ? diffResult.stdout.trim() : "";

  return {
    branchName,
    status,
    diffSummary,
  };
}
