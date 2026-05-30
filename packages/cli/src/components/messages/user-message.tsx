import { type ModeType, Mode } from "@knightcode/shared";
import { useTheme } from "../../providers/theme";
import { EmptyBorder } from "../utils/border";

type Props = {
  message: string;
  mode: ModeType;
};

export function UserMessage({ message, mode }: Props) {
  const { colors } = useTheme();

  return (
    <box width="100%" alignItems="stretch">
      <box
        border={["left"]}
        borderColor={
          mode === Mode.PLAN
            ? colors.planMode
            : mode === Mode.AUTO
              ? colors.autoMode
              : colors.primary
        }
        width="100%"
        customBorderChars={{
          ...EmptyBorder,
          vertical: "┃",
          bottomLeft: "╹",
        }}
      >
        <box
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
        >
          <text>{message}</text>
        </box>
      </box>
    </box>
  );
}
