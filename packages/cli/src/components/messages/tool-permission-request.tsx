import { type InputRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState, type ReactNode } from "react";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";
import { diffSummary } from "../../lib/ui/diff-summary";
import { commandRisk } from "../../lib/permissions/command-risk";
import { DiffBody } from "./diff-body";

type ToolKind = "Edit" | "Write" | "Bash";

type Props = {
  toolCallId: string;
  toolName: ToolKind;
  input: Record<string, unknown>;
  onConfirm: (
    toolCallId: string,
    approved: boolean,
    always: boolean,
    feedback?: string,
  ) => void;
};

type Option = {
  label: string;
  approved: boolean;
  always: boolean;
  reject?: boolean;
};

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function EditContent({
  oldString,
  newString,
  filePath,
}: {
  oldString: string;
  newString: string;
  filePath: string;
}) {
  const { additions, removals } = diffSummary(oldString, newString);
  return (
    <box flexDirection="column" width="100%" marginTop={1}>
      <text attributes={TextAttributes.DIM}>
        {plural(additions, "addition")}, {plural(removals, "removal")}
      </text>
      <DiffBody
        oldString={oldString}
        newString={newString}
        filePath={filePath}
      />
    </box>
  );
}

function WriteContent({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}) {
  return (
    <box flexDirection="column" width="100%" marginTop={1}>
      <DiffBody oldString="" newString={content} filePath={filePath} />
    </box>
  );
}

function BashContent({ command }: { command: string }) {
  const { colors } = useTheme();
  const risk = commandRisk(command);
  return (
    <box flexDirection="column" width="100%" marginTop={1}>
      {risk.level === "warn" ? (
        <box flexDirection="row" gap={1} marginBottom={1}>
          <text fg={colors.warning} attributes={TextAttributes.BOLD}>
            ⚠ {risk.reason}
          </text>
        </box>
      ) : null}
      <box
        flexDirection="column"
        width="100%"
        backgroundColor={colors.bashMessageBg}
        border={["left"]}
        borderColor={colors.bashBorder}
        paddingX={1}
      >
        {command.split("\n").map((line, i) => (
          <text key={i} fg={colors.info}>
            {line}
          </text>
        ))}
      </box>
    </box>
  );
}

/**
 * the reference TUI's permission dialog: a top-ruled panel with a title, a preview of
 * the proposed change (diff / file body / command), a question, and a numbered
 * options list. Arrow keys move, 1-3 jump, Enter confirms, Esc declines.
 *
 * The "No" row opens a free-text box so the user can tell the model what to do
 * instead; that guidance is threaded back as the tool's rejection reason. While
 * that box is focused it owns the keyboard, so the quick keys (1/2/3, y/n/a)
 * don't collide with typing.
 */
export function ToolPermissionRequest({
  toolCallId,
  toolName,
  input,
  onConfirm,
}: Props) {
  const { colors } = useTheme();
  const { isTopLayer } = useKeyboardLayer();
  const [index, setIndex] = useState(0);
  const feedbackRef = useRef<InputRenderable>(null);

  const filePath = String(input.file_path ?? "file");
  const name = basename(filePath);

  let title: string;
  let subtitle: string;
  let question: string;
  let content: ReactNode;
  let secondLabel: string;

  if (toolName === "Bash") {
    title = "Run command";
    subtitle = "";
    question = "Do you want to run this command?";
    content = <BashContent command={String(input.command ?? "")} />;
    secondLabel = "Yes, and don't ask again for this command";
  } else if (toolName === "Write") {
    title = "Write file";
    subtitle = filePath;
    question = `Do you want to create ${name}?`;
    content = (
      <WriteContent content={String(input.content ?? "")} filePath={filePath} />
    );
    secondLabel = "Yes, allow all edits this session";
  } else {
    title = "Edit file";
    subtitle = filePath;
    question = `Do you want to make this edit to ${name}?`;
    content = (
      <EditContent
        oldString={String(input.old_string ?? "")}
        newString={String(input.new_string ?? "")}
        filePath={filePath}
      />
    );
    secondLabel = "Yes, allow all edits this session";
  }

  const options: Option[] = [
    { label: "Yes", approved: true, always: false },
    { label: secondLabel, approved: true, always: true },
    {
      label: "No, and tell the model what to do differently (esc)",
      approved: false,
      always: false,
      reject: true,
    },
  ];

  const rejectIndex = options.length - 1;
  const inputFocused = index === rejectIndex;

  function choose(i: number) {
    const opt = options[i];
    if (!opt) return;
    if (opt.reject) {
      const feedback = feedbackRef.current?.value?.trim() || undefined;
      onConfirm(toolCallId, false, false, feedback);
      return;
    }
    onConfirm(toolCallId, opt.approved, opt.always);
  }

  useKeyboard((key) => {
    if (!isTopLayer("base")) return;

    if (key.name === "up") {
      key.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down") {
      key.preventDefault();
      setIndex((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      choose(index);
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      choose(rejectIndex);
      return;
    }

    // Quick keys are suppressed while the feedback box is focused so they can be
    // typed into it.
    if (inputFocused) return;

    if (key.name === "1" || key.name === "2" || key.name === "3") {
      key.preventDefault();
      choose(Number(key.name) - 1);
    } else if (key.name === "y" || key.name === "Y") {
      key.preventDefault();
      choose(0);
    } else if (key.name === "a" || key.name === "A") {
      key.preventDefault();
      choose(1);
    } else if (key.name === "n" || key.name === "N") {
      key.preventDefault();
      choose(rejectIndex);
    }
  });

  return (
    <box flexDirection="column" width="100%" marginY={1}>
      <box
        border={["top"]}
        borderColor={colors.autoMode}
        flexDirection="column"
        width="100%"
        paddingX={1}
        paddingTop={1}
      >
        <box flexDirection="row" justifyContent="space-between" width="100%">
          <text fg={colors.autoMode} attributes={TextAttributes.BOLD}>
            {title}
          </text>
          {subtitle ? (
            <text attributes={TextAttributes.DIM}>{subtitle}</text>
          ) : null}
        </box>

        {content}

        <box flexDirection="column" width="100%" marginTop={1}>
          <text>{question}</text>
          <box flexDirection="column" marginTop={1}>
            {options.map((opt, i) => {
              const selected = i === index;
              const fg = selected
                ? opt.reject
                  ? colors.error
                  : colors.autoMode
                : undefined;
              return (
                <box key={i} flexDirection="row" height={1}>
                  <text fg={fg}>{selected ? "❯ " : "  "}</text>
                  <text
                    fg={fg}
                    attributes={selected ? undefined : TextAttributes.DIM}
                  >
                    {i + 1}. {opt.label}
                  </text>
                </box>
              );
            })}
          </box>

          {inputFocused ? (
            <box flexDirection="column" width="100%" marginTop={1}>
              <text attributes={TextAttributes.DIM}>
                Tell the model what to do differently (optional):
              </text>
              <input
                ref={feedbackRef}
                placeholder="e.g. use a different approach, then press Enter…"
                focused
              />
            </box>
          ) : null}
        </box>
      </box>
      <box paddingX={1} marginTop={1}>
        <text attributes={TextAttributes.DIM}>
          {inputFocused
            ? "type guidance · Enter to decline · ↑ back to options"
            : "↑/↓ to select · Enter to confirm · Esc to decline"}
        </text>
      </box>
    </box>
  );
}
