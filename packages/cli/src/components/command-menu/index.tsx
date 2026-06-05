import type { RefObject } from "react";
import { COMMANDS } from "./commands";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { getFilteredCommands } from "./filter-commmands";
import { useTheme } from "../../providers/theme";

const MAX_VISIBLE_ITEMS = 8;

const COMMAND_COL_WIDTH = Math.max(
  ...COMMANDS.map((cmd) => cmd.name.length + 4),
);

type CommandMenuProps = {
  query: string;
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onSelect: (index: number) => void;
  onExecute: (index: number) => void;
};

export function CommandMenu({
  query,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: CommandMenuProps) {
  const { colors } = useTheme();
  const filtered = getFilteredCommands(query);
  const terminalHeight =
    process.stdout?.rows && process.stdout.rows > 0 ? process.stdout.rows : 24;
  const maxMenuHeight = Math.max(2, terminalHeight - 6);
  const visibleHeight = Math.min(
    filtered.length,
    MAX_VISIBLE_ITEMS,
    maxMenuHeight,
  );

  if (filtered.length === 0) {
    return (
      <box paddingX={1} backgroundColor={colors.surface}>
        <text attributes={TextAttributes.DIM}>No matching commands</text>
      </box>
    );
  }

  // the reference TUI style: the selected row is the accent color (not dim); every
  // other row is dimmed. No highlight bar, no pointer marker.
  return (
    <scrollbox
      ref={scrollRef}
      height={visibleHeight}
      backgroundColor={colors.surface}
    >
      {filtered.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        const fg = isSelected ? colors.primary : undefined;
        const attrs = isSelected ? undefined : TextAttributes.DIM;

        return (
          <box
            key={cmd.value}
            flexDirection="row"
            paddingX={1}
            height={1}
            onMouseMove={() => onSelect(i)}
            onMouseDown={() => onExecute(i)}
          >
            <box width={COMMAND_COL_WIDTH} flexShrink={0}>
              <text selectable={false} fg={fg} attributes={attrs}>
                /{cmd.name}
              </text>
            </box>
            <box flexGrow={1} flexShrink={1} overflow="hidden">
              <text selectable={false} fg={fg} attributes={attrs}>
                {cmd.description}
              </text>
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
}
