import { Mode, type ModeType } from "@knightcode/shared";
import { TextAttributes } from "@opentui/core";
import prettyMs from "pretty-ms";
import type { Message } from "../../hooks/use-chat";
import { useTheme } from "../../providers/theme";
import { EmptyBorder } from "../utils/border";
import { computeLineDiff } from "../../lib/git/diff";
import { InlineQuestion } from "./inline-question";
import { renderMarkdownLines } from "../../lib/markdown/markdown-renderer";

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

  if (toolName === "TodoWrite") {
    const todos = (tc.input as any).todos || [];
    const completed = todos.filter((i: any) => i.status === "completed").length;
    return `checklist (${completed}/${todos.length} completed)`;
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

function MarkdownText({
  text,
  defaultFg = "white",
  isThinking = false,
}: {
  text: string;
  defaultFg?: string;
  isThinking?: boolean;
}) {
  const { colors } = useTheme();
  const lines = renderMarkdownLines(text);

  function resolveFg(fg: string): string {
    switch (fg) {
      case "primary":
        return colors.primary;
      case "info":
        return colors.info;
      case "thinking":
        return colors.thinking;
      case "dim":
        return colors.dimSeparator;
      case "code":
        return isThinking ? defaultFg : colors.info;
      case "text":
      default:
        return defaultFg;
    }
  }

  return (
    <box flexDirection="column" width="100%" gap={0}>
      {lines.map((line, idx) => {
        let attributes = TextAttributes.NONE;
        if (line.bold) attributes |= TextAttributes.BOLD;
        if (line.dim) attributes |= TextAttributes.DIM;

        if (isThinking && line.fg === "code") {
          attributes |= TextAttributes.ITALIC | TextAttributes.DIM;
        }

        return (
          <text
            key={idx}
            fg={resolveFg(line.fg)}
            attributes={
              attributes === TextAttributes.NONE ? undefined : attributes
            }
          >
            {line.text || " "}
          </text>
        );
      })}
    </box>
  );
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
                  flexDirection="column"
                >
                  <text attributes={TextAttributes.DIM}>
                    <em fg={colors.thinking}>Thinking:</em>
                  </text>
                  <MarkdownText
                    text={part.text}
                    defaultFg="gray"
                    isThinking={true}
                  />
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

              if (isAskUserQuestion) {
                const input = part.input as any;
                const questions = Array.isArray(input?.questions)
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
                          <text fg="yellow" attributes={TextAttributes.BOLD}>
                            Question: {q.question}
                          </text>
                          {part.state === "output-available" && entry ? (
                            <text fg="green">Answer: {display}</text>
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
                const maxChars = 10000;
                const maxLines = 500;
                const combinedLength =
                  editInput.old_string.length + editInput.new_string.length;
                const combinedLines =
                  editInput.old_string.split("\n").length +
                  editInput.new_string.split("\n").length;

                const diffLines =
                  combinedLength > maxChars || combinedLines > maxLines
                    ? [
                        {
                          type: "unchanged" as const,
                          content: `[Diff too large to display (${combinedLength} characters, ${combinedLines} lines)]`,
                        },
                      ]
                    : computeLineDiff(editInput.old_string, editInput.new_string);
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
                      <text fg="white">{editInput.file_path || "file"}</text>
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
                (toolName === "Write" || toolName === "Bash")
              ) {
                const input = part.input as any;
                const description =
                  toolName === "Write"
                    ? `${input?.file_path ?? "file"} (${String(input?.content ?? "").length} chars)`
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
                  <MarkdownText text={part.text} />
                </box>
              );
            }

            return null;
          })}
        </box>
      ))}

      <box paddingX={3} paddingY={1} gap={1} width="100%">
        <box flexDirection="row" gap={2}>
          <text
            fg={
              mode === Mode.PLAN
                ? colors.planMode
                : mode === Mode.AUTO
                  ? colors.autoMode
                  : colors.primary
            }
          >
            ◉
          </text>
          <box flexDirection="row" gap={1}>
            <text>
              {mode === Mode.PLAN
                ? "Plan"
                : mode === Mode.AUTO
                  ? "Auto"
                  : "Build"}
            </text>
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
