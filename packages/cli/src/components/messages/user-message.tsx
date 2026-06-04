import { useTheme } from "../../providers/theme";

type Props = {
  message: string;
};

/**
 * The user's submitted prompt, echoed the reference TUI-style: a full-width
 * highlighted bar with a `>` prompt marker.
 */
export function UserMessage({ message }: Props) {
  const { colors } = useTheme();

  return (
    <box
      width="100%"
      backgroundColor={colors.surface}
      flexDirection="row"
      paddingX={1}
      marginTop={1}
    >
      <text fg={colors.dimSeparator}>{"> "}</text>
      <box flexGrow={1} flexShrink={1}>
        <text>{message}</text>
      </box>
    </box>
  );
}
