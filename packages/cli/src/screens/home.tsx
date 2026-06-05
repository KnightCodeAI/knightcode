import { useCallback } from "react";
import { useNavigate } from "react-router";
import { TextAttributes } from "@opentui/core";
import { Header } from "../components/header";
import { InputBar } from "../components/input-bar";
import { usePromptConfig } from "../providers/prompt-config";
import { useTheme } from "../providers/theme";
import { useUpdateCheck } from "../hooks/use-update-check";

export function Home() {
  const navigate = useNavigate();
  const { colors } = useTheme();
  const { mode, model, reasoningEffort } = usePromptConfig();
  const updateVersion = useUpdateCheck();
  const handleSubmit = useCallback(
    (text: string) => {
      navigate("/sessions/new", {
        state: { message: text, mode, model, reasoningEffort },
      });
    },
    [navigate, mode, model, reasoningEffort],
  );

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      height="100%"
      paddingX={2}
      paddingY={1}
      gap={1}
    >
      <box
        flexDirection="column"
        flexGrow={1}
        width="100%"
        height="50%"
        justifyContent="center"
        alignItems="center"
      >
        <Header />
      </box>
      <box flexGrow={1} />
      <InputBar onSubmit={handleSubmit} />
      <box flexDirection="row" gap={2} flexShrink={0} paddingLeft={1}>
        <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
          / for commands
        </text>
        <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
          @ for files
        </text>
        <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
          tab for mode
        </text>
      </box>
      {updateVersion ? (
        <box flexDirection="row" flexShrink={0} paddingLeft={1}>
          <text fg={colors.success} attributes={TextAttributes.DIM}>
            ★ Update available: v{updateVersion}  •  npm install -g @knightcode/cli
          </text>
        </box>
      ) : null}
    </box>
  );
}
