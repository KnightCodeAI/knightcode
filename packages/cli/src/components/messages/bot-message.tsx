import { getKnightcodeTool, type ModeType } from "@repo/shared";
import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import type { Message } from "../../lib/engine/messages";
import { useTheme } from "../../providers/theme";
import { BULLET, THINKING_MARK } from "../../lib/ui/figures";
import { formatDuration } from "../../lib/ui/format-duration";
import { pickCompletionVerb } from "../../lib/ui/spinner-verbs";
import { DiffView } from "./diff-view";
import { ToolCallView } from "./tool-call-view";
import { ToolPermissionRequest } from "./tool-permission-request";
import { InlineQuestion } from "./inline-question";
import { AgentSpawnConfirm } from "./agent-spawn-confirm";
import { MarkdownView } from "./markdown-view";

type ClientMessagePart = Message["parts"][number];
type ToolPart = Extract<
  ClientMessagePart,
  { type: `tool-${string}` | "dynamic-tool" }
>;

type Props = {
  parts: ClientMessagePart[];
  model: string;
  mode: ModeType;
  durationMs?: number;
  streaming?: boolean;
  pendingConfirmations?: any[];
  answerQuestion?: (
    toolCallId: string,
    answers: Array<{ question: string; answer: string | string[] }>,
  ) => void;
  setConfirmationModelOverride?: (
    toolCallId: string,
    modelId: import("@repo/shared").SupportedChatModelId | undefined,
  ) => void;
  confirmToolCall?: (
    toolCallId: string,
    approved: boolean,
    always: boolean,
    feedback?: string,
  ) => void;
  /** toolCallId of the confirmation at the front of the queue (the interactive one). */
  activePendingId?: string;
  /** toolCallIds currently executing (drives per-row spinners). */
  runningToolIds?: Set<string>;
};

function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

type PartGroup = {
  type: ClientMessagePart["type"];
  parts: ClientMessagePart[];
  key: string;
};

function groupConsecutiveParts(parts: ClientMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.type === part.type) {
      lastGroup.parts.push(part);
    } else {
      const key = isToolPart(part)
        ? `group-tc-${part.toolCallId}`
        : `group-${part.type}-${i}`;
      groups.push({ type: part.type, parts: [part], key });
    }
  }

  return groups;
}

export function BotMessage({
  parts,
  durationMs,
  streaming,
  pendingConfirmations = [],
  answerQuestion,
  setConfirmationModelOverride,
  confirmToolCall,
  activePendingId,
  runningToolIds,
}: Props) {
  const { colors } = useTheme();
  const [completionVerb] = useState(pickCompletionVerb);
  const hasContent = parts.some(
    (p) => p.type === "text" || isToolPart(p) || p.type === "reasoning",
  );
  // The trailing text part is the only one still mutating mid-stream; scope the
  // native markdown streaming mode to it.
  let lastTextPart: ClientMessagePart | undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]!.type === "text") {
      lastTextPart = parts[i];
      break;
    }
  }
  const showCompletion =
    !streaming && durationMs != null && durationMs > 0 && hasContent;
  return (
    <box width="100%" alignItems="stretch" marginTop={1}>
      {groupConsecutiveParts(parts).map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            if (part.type === "reasoning") {
              return (
                <box key={`reasoning-${j}`} width="100%" flexDirection="column">
                  <text fg={colors.thinking} attributes={TextAttributes.DIM}>
                    {THINKING_MARK} Thinking…
                  </text>
                  <box flexDirection="row" width="100%">
                    <text>{"  "}</text>
                    <box flexGrow={1} flexShrink={1}>
                      <MarkdownView text={part.text} isThinking />
                    </box>
                  </box>
                </box>
              );
            }

            if (isToolPart(part)) {
              const toolName =
                part.type === "dynamic-tool"
                  ? part.toolName
                  : part.type.slice("tool-".length);

              const isEditFile = toolName === "Edit";
              const isAskUserQuestion = toolName === "AskUserQuestion";
              const editInput =
                isEditFile && part.input && typeof part.input === "object"
                  ? (part.input as any)
                  : null;
              const isPending = pendingConfirmations.some(
                (c) => c.toolCallId === part.toolCallId,
              );
              const isActivePending = part.toolCallId === activePendingId;

              if (isAskUserQuestion) {
                const input = part.input as any;
                // Normalize through the contract schema: it wraps the legacy
                // flat shape ({question, options}) into {questions:[…]} — the
                // same normalization the engine's central parse applies, so a
                // pending question always gets its prompt UI.
                const parsed = getKnightcodeTool(
                  "AskUserQuestion",
                )?.input_schema.safeParse(input);
                const questions =
                  parsed?.success &&
                  Array.isArray((parsed.data as any)?.questions)
                    ? ((parsed.data as any).questions as any[])
                    : Array.isArray(input?.questions)
                      ? input.questions
                      : [];
                if (isPending && answerQuestion && questions.length > 0) {
                  return (
                    <InlineQuestion
                      key={part.toolCallId}
                      toolCallId={part.toolCallId}
                      questions={questions}
                      onAnswer={answerQuestion}
                    />
                  );
                }
                const outputAnswers = Array.isArray(
                  (part.output as any)?.answers,
                )
                  ? ((part.output as any).answers as Array<{
                      question: string;
                      answer: string | string[];
                    }>)
                  : [];
                return (
                  <box
                    key={part.toolCallId}
                    border={["left"]}
                    borderColor={colors.thinkingBorder}
                    paddingX={2}
                    flexDirection="column"
                    marginY={1}
                  >
                    {questions.map((q: any, qi: number) => {
                      const entry = outputAnswers.find(
                        (a) => a?.question === q.question,
                      );
                      const display = entry
                        ? Array.isArray(entry.answer)
                          ? entry.answer.join(", ")
                          : entry.answer
                        : "";
                      return (
                        <box
                          key={qi}
                          flexDirection="column"
                          marginBottom={qi < questions.length - 1 ? 1 : 0}
                        >
                          <text fg={colors.autoMode} attributes={TextAttributes.BOLD}>
                            Question: {q.question}
                          </text>
                          {part.state === "output-available" && entry ? (
                            <text fg={colors.success}>Answer: {display}</text>
                          ) : null}
                        </box>
                      );
                    })}
                  </box>
                );
              }

              if (
                editInput &&
                editInput.old_string !== undefined &&
                editInput.new_string !== undefined
              ) {
                if (isActivePending && confirmToolCall) {
                  return (
                    <ToolPermissionRequest
                      key={part.toolCallId}
                      toolCallId={part.toolCallId}
                      toolName="Edit"
                      input={editInput}
                      onConfirm={confirmToolCall}
                    />
                  );
                }
                return (
                  <DiffView
                    key={part.toolCallId}
                    filePath={editInput.file_path || "file"}
                    oldString={editInput.old_string}
                    newString={editInput.new_string}
                    pending={false}
                    errorText={
                      part.state === "output-error" ? part.errorText : undefined
                    }
                  />
                );
              }

              if (isActivePending && toolName === "Agent" && confirmToolCall) {
                const input = part.input as any;
                return (
                  <AgentSpawnConfirm
                    key={part.toolCallId}
                    toolCallId={part.toolCallId}
                    description={String(input?.description ?? "")}
                    subagentType={String(
                      input?.subagent_type ?? "general-purpose",
                    )}
                    aliasArg={input?.model}
                    onPickModel={(id) =>
                      setConfirmationModelOverride?.(part.toolCallId, id)
                    }
                    onConfirm={confirmToolCall}
                  />
                );
              }

              // Every other confirm-gated tool (Write, Bash, MultiEdit,
              // NotebookEdit, Config, …) gets the permission dialog — a
              // pending confirmation with no UI would deadlock the engine,
              // which awaits canUseTool forever.
              if (isActivePending && confirmToolCall) {
                return (
                  <ToolPermissionRequest
                    key={part.toolCallId}
                    toolCallId={part.toolCallId}
                    toolName={toolName}
                    input={(part.input as Record<string, unknown>) ?? {}}
                    onConfirm={confirmToolCall}
                  />
                );
              }

              return (
                <ToolCallView
                  key={part.toolCallId}
                  toolName={toolName}
                  input={part.input}
                  state={part.state}
                  output={part.output}
                  running={runningToolIds?.has(part.toolCallId) ?? false}
                  errorText={
                    part.state === "output-error" ? part.errorText : undefined
                  }
                />
              );
            }

            if (part.type === "text") {
              return (
                <box key={`text-${j}`} flexDirection="row" width="100%">
                  <text fg={colors.primary}>{BULLET} </text>
                  <box flexGrow={1} flexShrink={1}>
                    <MarkdownView
                      text={part.text}
                      streaming={!!streaming && part === lastTextPart}
                    />
                  </box>
                </box>
              );
            }

            return null;
          })}
        </box>
      ))}
      {showCompletion ? (
        <box flexDirection="row" gap={1} marginTop={1}>
          <text fg={colors.dimSeparator}>{THINKING_MARK}</text>
          <text attributes={TextAttributes.DIM}>
            {completionVerb} for {formatDuration(durationMs!)}
          </text>
        </box>
      ) : null}
    </box>
  );
}
