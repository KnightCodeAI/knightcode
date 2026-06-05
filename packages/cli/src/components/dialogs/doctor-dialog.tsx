import { useMemo } from "react";
import { TextAttributes } from "@opentui/core";
import { runDoctorChecks, type CheckStatus } from "../../lib/doctor/checks";
import { useTheme } from "../../providers/theme";

function statusColor(
  s: CheckStatus,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (s) {
    case "ok":
      return colors.success;
    case "warn":
      return colors.warning;
    case "fail":
      return colors.error;
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
  }
}

export function DoctorDialogContent() {
  const { colors } = useTheme();
  const checks = useMemo(() => runDoctorChecks(), []);

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.BOLD}>Knightcode diagnostics</text>
      {checks.map((check) => (
        <box key={check.label} flexDirection="row" gap={2}>
          <text fg={statusColor(check.status, colors)}>
            {statusIcon(check.status)}
          </text>
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
