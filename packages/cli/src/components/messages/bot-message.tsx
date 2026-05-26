import { Mode, type ModeType } from "@knightcode/shared";
import { TextAttributes } from "@opentui/core";
import prettyMs from "pretty-ms";
import type { Message } from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";
import { EmptyBorder } from "../utils/border";
import { computeLineDiff } from "../../lib/diff";
import { InlineQuestion } from "./inline-question";

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
  answerQuestion?: (toolCallId: string, answer: string | string[]) => void;
};

function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function isToolPart(part: ClientMessagePart): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function formatToolArgs(tc: ToolPart): string {
  if (!("input" in tc) || tc.input == null) return "";
  const toolName =
    tc.type === "dynamic-tool"
      ? (tc as any).toolName
      : tc.type.slice("tool-".length);

  if (toolName === "todoWrite") {
    const items = (tc.input as any).items || [];
    const completed = items.filter((i: any) => i.status === "completed").length;
    return `checklist (${completed}/${items.length} completed)`;
  }

  if (typeof tc.input !== "object") return String(tc.input);
  return Object.values(tc.input)
    .map((val) => {
      if (val == null) return "";
      if (typeof val === "object") {
        return JSON.stringify(val);
      }
      return String(val);
    })
    .join(" ");
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
  model,
  mode,
  durationMs,
  streaming = false,
  pendingConfirmations = [],
  answerQuestion,
}: Props) {
  const { colors } = useTheme();
  return (
    <box width="100%" alignItems="stretch">
      {groupConsecutiveParts(parts).map((group, i) => (
        <box key={group.key} width="100%" paddingTop={i === 0 ? 0 : 1}>
          {group.parts.map((part, j) => {
            if (part.type === "reasoning") {
              return (
                <box
                  key={`reasoning-${j}`}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{
                    ...EmptyBorder,
                    vertical: "│",
                  }}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking:</em> {part.text}
                  </text>
                </box>
              );
            }

            if (isToolPart(part)) {
              const toolName =
                part.type === "dynamic-tool"
                  ? part.toolName
                  : part.type.slice("tool-".length);

              const isEditFile = toolName === "editFile";
              const isAskUserQuestion = toolName === "AskUserQuestion";
              const editInput =
                isEditFile && part.input && typeof part.input === "object"
                  ? (part.input as any)
                  : null;
              const isPending = pendingConfirmations.some(
                (c) => c.toolCallId === part.toolCallId,
              );

              if (isAskUserQuestion) {
                if (isPending && answerQuestion) {
                  const input = part.input as any;
                  return (
                    <InlineQuestion
                      key={part.toolCallId}
                      toolCallId={part.toolCallId}
                      question={input.question}
                      options={input.options}
                      isMultiSelect={input.isMultiSelect}
                      onAnswer={answerQuestion}
                    />
                  );
                } else {
                  return (
                    <box
                      key={part.toolCallId}
                      border={["left"]}
                      borderColor={colors.thinkingBorder}
                      paddingX={2}
                      flexDirection="column"
                      marginY={1}
                    >
                      <text fg="yellow" attributes={TextAttributes.BOLD}>
                        Question: {(part.input as any)?.question}
                      </text>
                      {part.state === "output-available" && (
                        <text fg="green">
                          Answer:{" "}
                          {Array.isArray((part.output as any)?.answer)
                            ? (part.output as any).answer.join(", ")
                            : (part.output as any)?.answer}
                        </text>
                      )}
                    </box>
                  );
                }
              }

              if (
                editInput &&
                editInput.oldString !== undefined &&
                editInput.newString !== undefined
              ) {
                const maxChars = 10000;
                const maxLines = 500;
                const combinedLength =
                  editInput.oldString.length + editInput.newString.length;
                const combinedLines =
                  editInput.oldString.split("\n").length +
                  editInput.newString.split("\n").length;

                const diffLines =
                  combinedLength > maxChars || combinedLines > maxLines
                    ? [
                        {
                          type: "unchanged" as const,
                          content: `[Diff too large to display (${combinedLength} characters, ${combinedLines} lines)]`,
                        },
                      ]
                    : computeLineDiff(editInput.oldString, editInput.newString);
                return (
                  <box
                    key={part.toolCallId}
                    border={["top", "bottom", "left", "right"]}
                    borderColor={isPending ? "yellow" : colors.thinkingBorder}
                    padding={1}
                    flexDirection="column"
                    width="100%"
                    gap={0}
                    marginY={1}
                  >
                    <box
                      flexDirection="row"
                      justifyContent="space-between"
                      width="100%"
                    >
                      <text fg="white">{editInput.path || "file"}</text>
                      {part.state === "output-error" && (
                        <text fg="red">Failed: {part.errorText}</text>
                      )}
                    </box>
                    <box flexDirection="column" gap={0} marginTop={1}>
                      {diffLines.map((line, idx) => {
                        let fg = "white";
                        let prefix = "  ";
                        if (line.type === "added") {
                          fg = "green";
                          prefix = "+ ";
                        } else if (line.type === "deleted") {
                          fg = "red";
                          prefix = "- ";
                        } else {
                          fg = "gray";
                        }
                        return (
                          <text key={idx} fg={fg}>
                            {prefix}
                            {line.content}
                          </text>
                        );
                      })}
                    </box>
                    {isPending && (
                      <box flexDirection="column" gap={0} marginTop={1}>
                        <text fg="yellow" attributes={TextAttributes.BOLD}>
                          Accept changes? [y] Yes [n] No [a] Always
                        </text>
                      </box>
                    )}
                  </box>
                );
              }

              if (
                isPending &&
                (toolName === "writeFile" || toolName === "bash")
              ) {
                const input = part.input as any;
                const description =
                  toolName === "writeFile"
                    ? `${input?.path ?? "file"} (${String(input?.content ?? "").length} chars)`
                    : (input?.command ?? "");

                return (
                  <box
                    key={part.toolCallId}
                    border={["top", "bottom", "left", "right"]}
                    borderColor="yellow"
                    padding={1}
                    flexDirection="column"
                    width="100%"
                    gap={0}
                    marginY={1}
                  >
                    <text fg="yellow" attributes={TextAttributes.BOLD}>
                      Approve {formatToolName(toolName)}?
                    </text>
                    <text fg="white">{description}</text>
                    <text fg="yellow" attributes={TextAttributes.BOLD}>
                      Accept? [y] Yes [n] No [a] Always
                    </text>
                  </box>
                );
              }

              return (
                <box
                  key={part.toolCallId}
                  border={["left"]}
                  borderColor={colors.thinkingBorder}
                  customBorderChars={{
                    ...EmptyBorder,
                    vertical: "│",
                  }}
                  width="100%"
                  paddingX={2}
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.info}>{formatToolName(toolName)}:</em>{" "}
                    {formatToolArgs(part)}
                    {part.state !== "output-available" &&
                    part.state !== "output-error"
                      ? " …"
                      : ""}
                    {part.state === "output-error" ? ` ${part.errorText}` : ""}
                  </text>
                </box>
              );
            }

            if (part.type === "text") {
              return (
                <box key={`text-${j}`} paddingX={3} width="100%">
                  <text>{part.text}</text>
                </box>
              );
            }

            return null;
          })}
        </box>
      ))}

      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text fg={mode === Mode.PLAN ? colors.planMode : colors.primary}>
            ◉
          </text>
          <box flexDirection="row" gap={1}>
            <text>{mode === Mode.PLAN ? "Plan" : "Build"}</text>
            <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
              ›
            </text>
            <text attributes={TextAttributes.DIM}>{model}</text>
            {durationMs != null && (
              <>
                <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
                  ›
                </text>
                <text attributes={TextAttributes.DIM}>
                  {prettyMs(durationMs)}
                </text>
              </>
            )}
          </box>
        </box>
      </box>
    </box>
  );
}
