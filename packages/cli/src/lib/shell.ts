import { accessSync, constants, existsSync } from "fs";
import { join } from "path";

export type ShellInfo = {
  name: "bash" | "zsh" | "sh" | "pwsh" | "powershell";
  bin: string;
  // All args that precede the command, e.g. ["-c"] or ["-NoProfile", "-NonInteractive", "-Command"]
  args: string[];
};

let _cached: ShellInfo | null = null;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Check whether a plain binary name (no path separators) resolves via PATH.
function isOnWindowsPath(bin: string): boolean {
  const pathEnv = process.env["PATH"] ?? process.env["Path"] ?? "";
  return pathEnv
    .split(";")
    .filter(Boolean)
    .some((dir) => existsSync(join(dir.trim(), bin)));
}

function detectWindowsShell(): ShellInfo {
  // Prefer PowerShell Core (pwsh) — supports &&, ||, modern syntax.
  // Fall back to Windows PowerShell 5.1 (powershell.exe), which ships on every Windows.
  const candidates: Array<{ bin: string; name: ShellInfo["name"] }> = [
    { bin: "pwsh.exe", name: "pwsh" },
    // Standard install location for PS 7+ (absolute — checked with existsSync)
    {
      bin: `${process.env["ProgramFiles"] ?? "C:\\Program Files"}\\PowerShell\\7\\pwsh.exe`,
      name: "pwsh",
    },
    { bin: "powershell.exe", name: "powershell" },
  ];

  for (const { bin, name } of candidates) {
    const available = bin.includes("\\")
      ? existsSync(bin) // absolute path — check disk
      : isOnWindowsPath(bin); // plain name — check PATH dirs
    if (available) {
      return { name, bin, args: ["-NoProfile", "-NonInteractive", "-Command"] };
    }
  }

  // powershell.exe ships on every Windows; if somehow not on PATH fall back unconditionally.
  return {
    name: "powershell",
    bin: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command"],
  };
}

function detectUnixShell(): ShellInfo {
  // 1. Respect $SHELL if it points to bash or zsh and is executable
  const envShell = process.env["SHELL"] ?? "";
  if (envShell && isExecutable(envShell)) {
    if (envShell.endsWith("/zsh"))
      return { name: "zsh", bin: envShell, args: ["-c"] };
    if (envShell.endsWith("/bash"))
      return { name: "bash", bin: envShell, args: ["-c"] };
  }

  // 2. Search well-known locations.
  //    macOS ships zsh as the default shell since Catalina → prefer it there.
  //    Linux users expect bash.
  const isMac = process.platform === "darwin";
  const candidates = isMac
    ? [
        "/bin/zsh",
        "/usr/local/bin/zsh",
        "/opt/homebrew/bin/zsh",
        "/bin/bash",
        "/usr/bin/bash",
        "/usr/local/bin/bash",
      ]
    : [
        "/bin/bash",
        "/usr/bin/bash",
        "/usr/local/bin/bash",
        "/bin/zsh",
        "/usr/bin/zsh",
      ];

  for (const bin of candidates) {
    if (isExecutable(bin)) {
      const name = bin.includes("zsh") ? "zsh" : "bash";
      return { name, bin, args: ["-c"] };
    }
  }

  // 3. POSIX fallback — /bin/sh is always present
  return { name: "sh", bin: "/bin/sh", args: ["-c"] };
}

/**
 * Detect the effective shell for this platform.
 * Result is memoized for the process lifetime.
 */
export function detectShell(): ShellInfo {
  if (_cached) return _cached;
  _cached =
    process.platform === "win32" ? detectWindowsShell() : detectUnixShell();
  return _cached;
}

/** Clear the cached result (for tests). */
export function resetShellCache(): void {
  _cached = null;
}
