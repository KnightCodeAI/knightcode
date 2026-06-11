import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { useTheme } from "../../providers/theme";

type Props = {
  title: string;
  /** Dim line under the title (file path, subagent type, …). */
  subtitle?: string;
  children: ReactNode;
};

/**
 * Shared frame for every interactive prompt (permissions, agent spawn,
 * questions), mirroring claude-code's PermissionDialog/PermissionRequestTitle:
 * a top-ruled panel in the permission accent color, a bold title with a dim
 * subtitle below it, then the request-specific content.
 */
export function PermissionPanel({ title, subtitle, children }: Props) {
  const { colors } = useTheme();
  return (
    <box
      border={["top"]}
      borderColor={colors.autoMode}
      flexDirection="column"
      width="100%"
      marginTop={1}
      paddingX={1}
      paddingTop={1}
    >
      <box flexDirection="column" width="100%">
        <text fg={colors.autoMode} attributes={TextAttributes.BOLD}>
          {title}
        </text>
        {subtitle ? (
          <text attributes={TextAttributes.DIM}>{subtitle}</text>
        ) : null}
      </box>
      {children}
    </box>
  );
}
