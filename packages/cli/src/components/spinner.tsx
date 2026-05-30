import { type ModeType, Mode } from "@knightcode/shared";
import "opentui-spinner/react";
import { useTheme } from "../providers/theme";

type Props = {
  mode?: ModeType;
};

export function Spinner({ mode = Mode.BUILD }: Props) {
  const { colors } = useTheme();
  const activeColor =
    mode === Mode.PLAN
      ? colors.planMode
      : mode === Mode.AUTO
        ? colors.autoMode
        : colors.primary;
  return <spinner name="dots14" color={activeColor} />;
}
