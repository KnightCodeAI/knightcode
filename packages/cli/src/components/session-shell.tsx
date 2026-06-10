import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import { InputBar } from "./input-bar";
import { WorkingIndicator } from "./working-indicator";
import { TodoPanel } from "./todo-panel";
import { usePromptConfig } from "../providers/prompt-config";
import { useVerbose } from "../providers/verbose";
import type { Message } from "../lib/engine/messages";

type Props = {
  children?: ReactNode;
  onSubmit: (text: string) => void;
  inputDisabled?: boolean;
  isCompacting?: boolean;
  loading?: boolean;
  turnStartMs?: number;
  getPausedMs?: () => number;
  responseChars?: number;
  toolActive?: boolean;
  interruptible?: boolean;
  compact?: () => void | Promise<void>;
  clearMessages?: () => Promise<void>;
  rewindMessages?: (n: number) => Promise<void>;
  submitMessage?: (text: string) => void;
  submitCommand?: (text: string, progressMessage: string) => void;
  messages?: Message[];
  tokenStats?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    lastInputTokens?: number;
  };
};

export function SessionShell({
  children,
  onSubmit,
  inputDisabled = false,
  isCompacting = false,
  loading = false,
  turnStartMs,
  getPausedMs,
  responseChars,
  toolActive,
  interruptible = false,
  compact,
  clearMessages,
  rewindMessages,
  submitMessage,
  submitCommand,
  messages,
  tokenStats,
}: Props) {
  const { mode } = usePromptConfig();
  const { verbose } = useVerbose();
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      height="100%"
      paddingY={1}
      paddingX={2}
      gap={1}
    >
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        width="100%"
        stickyScroll
        stickyStart="bottom"
      >
        <box>{children}</box>
      </scrollbox>
      <TodoPanel />
      {loading || isCompacting ? (
        <box flexShrink={0} height={1}>
          <WorkingIndicator
            mode={mode}
            startMs={turnStartMs}
            getPausedMs={getPausedMs}
            responseChars={responseChars}
            toolActive={toolActive}
            interruptible={interruptible}
            isCompacting={isCompacting}
          />
        </box>
      ) : null}
      <box flexShrink={0}>
        <InputBar
          onSubmit={onSubmit}
          disabled={inputDisabled}
          isCompacting={isCompacting}
          compact={compact}
          clearMessages={clearMessages}
          rewindMessages={rewindMessages}
          submitMessage={submitMessage}
          submitCommand={submitCommand}
          messages={messages}
          tokenStats={tokenStats}
        />
      </box>
      <box
        flexShrink={0}
        flexDirection="row"
        justifyContent="flex-end"
        width="100%"
        height={1}
        gap={2}
        paddingLeft={1}
      >
        <box flexDirection="row" gap={3} flexShrink={0} marginLeft="auto">
          <box flexDirection="row" gap={1}>
            <text>ctrl+o</text>
            <text attributes={TextAttributes.DIM}>
              {verbose ? "collapse" : "expand"}
            </text>
          </box>
          <box flexDirection="row" gap={1}>
            <text>tab</text>
            <text attributes={TextAttributes.DIM}>agents</text>
          </box>
        </box>
      </box>
    </box>
  );
}
