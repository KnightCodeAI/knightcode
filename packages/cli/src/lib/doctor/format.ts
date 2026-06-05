import type { CheckStatus, DoctorCheck } from "./checks";

const ICON: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

/** Plain-text diagnostic block for `knightcode doctor` (no TUI, no color). */
export function formatDoctorReport(version: string, checks: DoctorCheck[]): string {
  const lines = [
    `knightcode ${version}`,
    `platform: ${process.platform}-${process.arch}`,
    "",
  ];
  const width = Math.max(...checks.map((c) => c.label.length));
  for (const c of checks) {
    const label = c.label.padEnd(width);
    const detail = c.detail ? `  ${c.detail}` : "";
    lines.push(`${ICON[c.status]} ${label}${detail}`);
  }
  return lines.join("\n");
}

/** Exit 1 only when a check structurally failed; warns stay green. */
export function doctorExitCode(checks: DoctorCheck[]): number {
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}
