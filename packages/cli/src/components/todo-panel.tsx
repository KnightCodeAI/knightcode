import { TextAttributes } from "@opentui/core";
import { useTodo, type TodoItem } from "../providers/todo";
import { useTheme } from "../providers/theme";
import { useKeyboardLayer } from "../providers/keyboard-layer";

function statusIcon(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "[x]";
    case "in_progress":
      return "[/]";
    case "pending":
      return "[ ]";
  }
}

function statusColor(
  status: TodoItem["status"],
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (status) {
    case "completed":
      return colors.success;
    case "in_progress":
      return colors.warning;
    case "pending":
      return colors.dimSeparator;
  }
}

export function TodoPanel() {
  const { items, isExpanded } = useTodo();
  const { colors } = useTheme();
  const { hasLayer } = useKeyboardLayer();

  if (items.length === 0) return null;
  if (hasLayer("command") || hasLayer("mention")) return null;

  const completed = items.filter((i) => i.status === "completed").length;
  const total = items.length;

  return (
    <box
      flexDirection="column"
      width="100%"
      border={["top"]}
      borderColor={colors.thinkingBorder}
      paddingX={1}
      paddingY={0}
      gap={0}
      flexShrink={0}
    >
      {/* Header / Summary Line */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        width="100%"
        height={1}
      >
        <box flexDirection="row" gap={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.primary}>
            Progress
          </text>
          <text fg={colors.dimSeparator}>
            ({completed}/{total})
          </text>
          <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
            [ctrl+t to {isExpanded ? "collapse" : "expand"}]
          </text>
        </box>
      </box>

      {/* Expanded list of items */}
      {isExpanded && (
        <box flexDirection="column" gap={0} marginTop={0}>
          {items.map((item) => (
            <box key={item.id} flexDirection="row" gap={1} height={1}>
              <text fg={statusColor(item.status, colors)}>
                {statusIcon(item.status)}
              </text>
              <text
                fg={item.status === "completed" ? colors.dimSeparator : colors.text}
                attributes={
                  item.status === "completed" ? TextAttributes.DIM : undefined
                }
              >
                {item.label}
              </text>
            </box>
          ))}
        </box>
      )}
    </box>
  );
}
