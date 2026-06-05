/** Heuristic risk hints for shell commands shown in the Bash permission dialog. */

export type CommandRisk = { level: "warn"; reason: string } | { level: null };

const NONE: CommandRisk = { level: null };

/**
 * Best-effort warning for obviously destructive/dangerous shell commands. This
 * is advisory only — it never blocks; the user still decides. Patterns are
 * ordered most-severe first and the first match wins.
 */
export function commandRisk(command: string): CommandRisk {
  const cmd = command.trim();
  if (!cmd) return NONE;
  const lower = cmd.toLowerCase();

  // Fork bomb
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(cmd.replace(/\s+/g, ""))
    || cmd.replace(/\s+/g, "").includes(":(){:|:&};:")) {
    return { level: "warn", reason: "Fork bomb — can crash the machine" };
  }

  // rm -rf / rm -fr (recursive + force, any flag order)
  if (
    /\brm\b/.test(lower) &&
    (/-[a-z]*r/.test(lower) || /--recursive\b/.test(lower)) &&
    (/-[a-z]*f/.test(lower) || /--force\b/.test(lower))
  ) {
    return { level: "warn", reason: "Recursively force-deletes files" };
  }

  // dd to a disk device
  if (/\bdd\b/.test(lower) && /of=/.test(lower)) {
    return { level: "warn", reason: "Low-level disk write — can destroy data" };
  }

  // mkfs / format a filesystem
  if (/\bmkfs\b/.test(lower) || /\bformat\b\s+[a-z]:/.test(lower)) {
    return { level: "warn", reason: "Formats a filesystem — erases data" };
  }

  // chmod 777 (world-writable)
  if (/\bchmod\b\s+(-[a-z]*\s+)*777\b/.test(lower)) {
    return { level: "warn", reason: "Grants full permissions to everyone" };
  }

  // Pipe a remote script straight into a shell
  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(lower)) {
    return {
      level: "warn",
      reason: "Pipes a remote script straight into a shell",
    };
  }

  // Force push — can overwrite remote history
  if (/\bgit\b[^&|;]*\bpush\b/.test(lower) && /(--force(-with-lease)?|\s-f\b)/.test(lower)) {
    return { level: "warn", reason: "Force-push can overwrite remote history" };
  }

  // Redirect into a device file
  if (/>\s*\/dev\/(sd|nvme|disk|hd)/.test(lower)) {
    return { level: "warn", reason: "Writes directly to a disk device" };
  }

  // sudo (elevated privileges) — lowest priority, checked last
  if (/\bsudo\b/.test(lower)) {
    return { level: "warn", reason: "Runs with elevated privileges" };
  }

  return NONE;
}
