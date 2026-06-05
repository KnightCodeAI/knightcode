import { useTheme } from "../providers/theme";

export function Header() {
  const { colors } = useTheme();
  return (
    <box flexDirection="row" gap={0.5} alignItems="center">
      <ascii-font font="tiny" text="Knight" color={colors.dimSeparator} />
      <ascii-font font="tiny" text="Code" color={colors.primary} />
    </box>
  );
}
