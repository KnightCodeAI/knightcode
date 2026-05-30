import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useState, useRef, useEffect } from "react";
import { useDialog } from "../../providers/dialogs";
import { useKeyboard } from "@opentui/react";
import { getFilteredCommands } from "../command-menu/filter-commmands";
import { useKeyboardLayer } from "../../providers/keyboard-layer";

const MAX_VISIBLE_HELP_ITEMS = 10;

export function HelpDialogContent() {
  const { close } = useDialog();
  const { isTopLayer } = useKeyboardLayer();
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const allCmds = getFilteredCommands("");
  const filtered = allCmds.filter(
    (c) =>
      query === "" ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.description.toLowerCase().includes(query.toLowerCase()),
  );

  // Reset scroll when query changes
  useEffect(() => {
    setScrollTop(0);
    scrollRef.current?.scrollTo(0);
  }, [query]);

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.name === "escape") {
      key.preventDefault();
      close();
    } else if (key.name === "backspace") {
      key.preventDefault();
      setQuery((q) => q.slice(0, -1));
    } else if (key.name === "up") {
      key.preventDefault();
      setScrollTop((s) => {
        const next = Math.max(0, s - 1);
        scrollRef.current?.scrollTo(next);
        return next;
      });
    } else if (key.name === "down") {
      key.preventDefault();
      setScrollTop((s) => {
        const maxScroll = Math.max(0, filtered.length - MAX_VISIBLE_HELP_ITEMS);
        const next = Math.min(maxScroll, s + 1);
        scrollRef.current?.scrollTo(next);
        return next;
      });
    } else if (!key.ctrl && !key.meta && key.name.length === 1) {
      const char = key.shift ? key.name.toUpperCase() : key.name;
      setQuery((q) => q + char);
    } else if (key.name === "space") {
      setQuery((q) => q + " ");
    }
  });

  const visibleHeight = Math.min(filtered.length, MAX_VISIBLE_HELP_ITEMS);

  return (
    <box flexDirection="column" gap={1} width="100%">
      <box flexDirection="row" gap={1}>
        <text fg="gray">Search:</text>
        <text>{query || " "}</text>
      </box>
      {filtered.length === 0 ? (
        <box height={visibleHeight}>
          <text attributes={TextAttributes.DIM}>No matching commands</text>
        </box>
      ) : (
        <scrollbox ref={scrollRef} height={visibleHeight}>
          {filtered.map((cmd) => (
            <box
              key={cmd.name}
              flexDirection="row"
              gap={2}
              paddingY={0}
              height={1}
              overflow="hidden"
            >
              <box width={18} flexShrink={0}>
                <text fg="cyan">{cmd.value}</text>
              </box>
              <text attributes={TextAttributes.DIM}>{cmd.description}</text>
            </box>
          ))}
        </scrollbox>
      )}
      <text attributes={TextAttributes.DIM} fg="gray">
        Type to filter • [↑/↓] Scroll • [Esc] Close
      </text>
    </box>
  );
}
