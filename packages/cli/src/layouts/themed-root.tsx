import { type ReactNode } from "react";
import { useTheme } from "../providers/theme";

type Props = {
  children: ReactNode;
};

export function ThemedRoot({ children }: Props) {
  const { colors } = useTheme();

  return (
    <box
      width="100%"
      height="100%"
      flexGrow={1}
      backgroundColor={colors.background}
    >
      {children}
    </box>
  );
}
