import { markIntentionalExit } from "../lib/exit-guard";
import { drainMemoryExtraction } from "../lib/memory/extract-scheduler";
import { Mode } from "@repo/shared";
import {
  ScrollBoxRenderable,
  TextAttributes,
  type KeyBinding,
  type TextareaRenderable,
} from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { readdir } from "fs/promises";
import { isAbsolute, relative, resolve } from "path";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useNavigate, useParams } from "react-router";
import { useDialog } from "../providers/dialogs";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useOnboarding } from "../providers/onboarding";
import { usePromptConfig } from "../providers/prompt-config";
import { useTheme } from "../providers/theme";
import { useToast } from "../providers/toast";
import { CommandMenu } from "./command-menu";
import type { Command } from "./command-menu/types";
import { useCommandMenu } from "./command-menu/use-command-menu";
import { StatusBar } from "./status-bar";

const MAX_VISIBLE_MENTIONS = 8;
const CURRENT_DIRECTORY = process.cwd();
const MAX_FALLBACK_MENTION_CANDIDATES = 32;
const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/;
const RECURSIVE_MENTION_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "venv",
  ".venv",
  "env",
  ".env",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target",
  "__pycache__",
  ".turbo",
  ".idea",
  ".vscode",
]);

type MentionMatch = {
  start: number;
  end: number;
  query: string;
};

type MentionCandidate = {
  path: string;
  kind: "file" | "directory";
};

function isWithinCurrentDirectory(targetPath: string) {
  const relativePath = relative(CURRENT_DIRECTORY, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isMentionQueryCharacter(character: string) {
  return MENTION_QUERY_CHARACTER.test(character);
}

function findActiveMention(
  text: string,
  cursorOffset: number,
): MentionMatch | null {
  const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));

  let start = safeOffset;
  while (start > 0 && !/\s/.test(text[start - 1]!)) {
    start -= 1;
  }

  let end = safeOffset;
  while (end < text.length && !/\s/.test(text[end]!)) {
    end += 1;
  }

  const token = text.slice(start, end);
  const relativeCursor = safeOffset - start;
  const mentionStart = token.lastIndexOf("@", relativeCursor);

  if (mentionStart === -1) {
    return null;
  }

  const previousCharacter = token[mentionStart - 1];
  if (previousCharacter && isMentionQueryCharacter(previousCharacter)) {
    return null;
  }

  let mentionEnd = mentionStart + 1;
  while (
    mentionEnd < token.length &&
    isMentionQueryCharacter(token[mentionEnd]!)
  ) {
    mentionEnd += 1;
  }

  if (relativeCursor < mentionStart || relativeCursor > mentionEnd) {
    return null;
  }

  return {
    start: start + mentionStart,
    end: start + mentionEnd,
    query: token.slice(mentionStart + 1, mentionEnd),
  };
}

async function getMentionCandidates(
  query: string,
): Promise<MentionCandidate[]> {
  const normalizedQuery = query.startsWith("./") ? query.slice(2) : query;
  if (normalizedQuery.startsWith("/")) {
    return [];
  }

  const hasTrailingSlash = normalizedQuery.endsWith("/");
  const lastSlashIndex = hasTrailingSlash
    ? normalizedQuery.length - 1
    : normalizedQuery.lastIndexOf("/");

  const directoryPart = hasTrailingSlash
    ? normalizedQuery.slice(0, -1)
    : lastSlashIndex === -1
      ? ""
      : normalizedQuery.slice(0, lastSlashIndex);

  const namePrefix = hasTrailingSlash
    ? ""
    : lastSlashIndex === -1
      ? normalizedQuery
      : normalizedQuery.slice(lastSlashIndex + 1);

  const absoluteDirectory = resolve(CURRENT_DIRECTORY, directoryPart || ".");
  if (!isWithinCurrentDirectory(absoluteDirectory)) {
    return [];
  }

  try {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const lowercasePrefix = namePrefix.toLowerCase();
    const showHiddenEntries = namePrefix.startsWith(".");

    const directMatches = entries
      .filter((entry) => showHiddenEntries || !entry.name.startsWith("."))
      .filter((entry) => {
        if (
          entry.isDirectory() &&
          RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name)
        ) {
          return false;
        }
        return (
          lowercasePrefix === "" ||
          entry.name.toLowerCase().startsWith(lowercasePrefix)
        );
      })
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map((entry) => {
        const path = directoryPart
          ? `${directoryPart}/${entry.name}`
          : entry.name;
        const kind: MentionCandidate["kind"] = entry.isDirectory()
          ? "directory"
          : "file";
        return {
          path: kind === "directory" ? `${path}/` : path,
          kind,
        };
      });

    if (
      directMatches.length > 0 ||
      directoryPart !== "" ||
      namePrefix === "" ||
      namePrefix.length < 2
    ) {
      return directMatches;
    }

    const fallbackMatches: MentionCandidate[] = [];
    const visit = async (
      absoluteDirectory: string,
      directoryPart: string,
    ): Promise<void> => {
      const entries = await readdir(absoluteDirectory, { withFileTypes: true });

      for (const entry of entries) {
        if (!showHiddenEntries && entry.name.startsWith(".")) {
          continue;
        }

        if (
          entry.isDirectory() &&
          RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name)
        ) {
          continue;
        }

        const path = directoryPart
          ? `${directoryPart}/${entry.name}`
          : entry.name;
        const kind: MentionCandidate["kind"] = entry.isDirectory()
          ? "directory"
          : "file";

        if (entry.name.toLowerCase().startsWith(lowercasePrefix)) {
          fallbackMatches.push({
            path: kind === "directory" ? `${path}/` : path,
            kind,
          });
          if (fallbackMatches.length >= MAX_FALLBACK_MENTION_CANDIDATES) {
            return;
          }
        }

        if (entry.isDirectory()) {
          await visit(resolve(absoluteDirectory, entry.name), path);
          if (fallbackMatches.length >= MAX_FALLBACK_MENTION_CANDIDATES) {
            return;
          }
        }
      }
    };

    await visit(CURRENT_DIRECTORY, "");
    return fallbackMatches.sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  } catch {
    return [];
  }
}

type FileMentionMenuProps = {
  candidates: MentionCandidate[];
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onSelect: (index: number) => void;
  onExecute: (index: number) => void;
};

function FileMentionMenu({
  candidates,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: FileMentionMenuProps) {
  const { colors } = useTheme();
  const terminalHeight =
    process.stdout?.rows && process.stdout.rows > 0 ? process.stdout.rows : 24;
  const maxMenuHeight = Math.max(2, terminalHeight - 6);
  const visibleHeight = Math.min(
    candidates.length,
    MAX_VISIBLE_MENTIONS,
    maxMenuHeight,
  );

  if (candidates.length === 0) {
    return (
      <box paddingX={1} backgroundColor={colors.surface}>
        <text attributes={TextAttributes.DIM}>
          No matching files or folders
        </text>
      </box>
    );
  }

  return (
    <scrollbox
      ref={scrollRef}
      height={visibleHeight}
      backgroundColor={colors.surface}
    >
      {candidates.map((candidate, index) => {
        const isSelected = index === selectedIndex;
        const fg = isSelected ? colors.primary : undefined;
        const attrs = isSelected ? undefined : TextAttributes.DIM;

        return (
          <box
            key={candidate.path}
            flexDirection="row"
            paddingX={1}
            height={1}
            overflow="hidden"
            onMouseMove={() => onSelect(index)}
            onMouseDown={() => onExecute(index)}
          >
            <box width={2} flexShrink={0}>
              <text selectable={false} fg={fg} attributes={attrs}>
                +
              </text>
            </box>
            <box flexGrow={1} flexShrink={1} overflow="hidden">
              <text selectable={false} fg={fg} attributes={attrs}>
                {candidate.path}
              </text>
            </box>

            <box width={8} alignItems="flex-end" flexShrink={0}>
              <text selectable={false} fg={fg} attributes={attrs}>
                {candidate.kind === "directory" ? "Folder" : "File"}
              </text>
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
}

import type { Message } from "../lib/engine/messages";

type Props = {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  isCompacting?: boolean;
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

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "enter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "enter", shift: true, action: "newline" },
];

export function InputBar({
  onSubmit,
  disabled = false,
  isCompacting = false,
  compact,
  clearMessages,
  rewindMessages,
  submitMessage,
  submitCommand,
  messages,
  tokenStats,
}: Props) {
  const {
    mode,
    toggleMode,
    setMode,
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
  } = usePromptConfig();

  const textareaRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
  const renderer = useRenderer();
  const navigate = useNavigate();
  const activeMentionRef = useRef<MentionMatch | null>(null);
  const mentionScrollRef = useRef<ScrollBoxRenderable>(null);
  const { id: sessionId } = useParams();
  const toast = useToast();
  const dialog = useDialog();
  const { start: startOnboarding } = useOnboarding();
  const { colors } = useTheme();
  const { isTopLayer, setResponder, push, pop } = useKeyboardLayer();
  const {
    showCommandMenu,
    commandQuery,
    selectedIndex,
    scrollRef,
    handleContentChange,
    resolveCommand,
    setSelectedIndex,
  } = useCommandMenu();
  const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<
    MentionCandidate[]
  >([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const showMentionMenu = activeMention !== null;

  const closeMentionMenu = useCallback(() => {
    activeMentionRef.current = null;
    setActiveMention(null);
    setMentionCandidates([]);
    pop("mention");
  }, [pop]);

  const syncMentionMenu = useCallback(
    (text: string, cursorOffset: number) => {
      const nextMention = findActiveMention(text, cursorOffset);
      const previousMention = activeMentionRef.current;
      const mentionChanged =
        previousMention?.start !== nextMention?.start ||
        previousMention?.end !== nextMention?.end ||
        previousMention?.query !== nextMention?.query;

      if (!nextMention) {
        if (previousMention) {
          closeMentionMenu();
        }
        return;
      }

      activeMentionRef.current = nextMention;
      setActiveMention(nextMention);
      push("mention", () => {
        closeMentionMenu();
        return true;
      });

      if (mentionChanged) {
        setMentionSelectedIndex(0);
        mentionScrollRef.current?.scrollTo(0);
      }
    },
    [closeMentionMenu, push],
  );

  const handleTextareaContentChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const text = textarea.plainText;
    handleContentChange(text);
    syncMentionMenu(text, textarea.cursorOffset);
  }, [handleContentChange, syncMentionMenu]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const text = textarea.plainText.trim();
    if (text.length === 0) return;

    onSubmit(text);
    textarea.setText("");
  }, [disabled, onSubmit]);

  const handleMentionExecute = useCallback(
    (index: number) => {
      const textarea = textareaRef.current;
      const mention = activeMentionRef.current;
      const candidate = mentionCandidates[index];

      if (!textarea || !mention || !candidate) return;

      const insertion =
        candidate.kind === "directory" ? candidate.path : `${candidate.path} `;

      const nextText = `${textarea.plainText.slice(0, mention.start)}@${insertion}${textarea.plainText.slice(mention.end)}`;

      textarea.replaceText(nextText);
      textarea.cursorOffset = mention.start + insertion.length + 1;
      syncMentionMenu(nextText, textarea.cursorOffset);
    },
    [mentionCandidates, syncMentionMenu],
  );

  const handleTextareaCursorChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    syncMentionMenu(textarea.plainText, textarea.cursorOffset);
  }, [syncMentionMenu]);

  const handleCommand = useCallback(
    (command: Command | undefined) => {
      const textarea = textareaRef.current;
      if (!textarea || !command) return;

      textarea.setText("");

      if (command.action) {
        command.action({
          exit: () => {
            markIntentionalExit();
            // Let an in-flight memory extraction finish persisting before we
            // tear down, but never let a slow/hung side model block exit.
            // Resolves instantly in the common case (nothing in flight).
            let timer: ReturnType<typeof setTimeout>;
            const deadline = new Promise<void>((r) => {
              timer = setTimeout(r, 3000);
            });
            void Promise.race([drainMemoryExtraction(), deadline]).finally(
              () => {
                // Clear the timer so a fast drain doesn't leave it pending and
                // keep the event loop alive (delaying actual process exit).
                clearTimeout(timer);
                renderer.destroy();
              },
            );
          },
          toast,
          dialog,
          navigate,
          mode,
          setMode,
          model,
          setModel,
          startOnboarding,
          reasoningEffort,
          setReasoningEffort,
          sessionId,
          compact,
          clearMessages,
          rewindMessages,
          submitMessage,
          submitCommand,
          messages,
          tokenStats,
        });
      } else {
        textarea.insertText(command.value + " ");
      }
    },
    [
      renderer,
      toast,
      dialog,
      navigate,
      mode,
      setMode,
      model,
      setModel,
      startOnboarding,
      reasoningEffort,
      setReasoningEffort,
      sessionId,
      compact,
      clearMessages,
      rewindMessages,
      submitMessage,
      submitCommand,
      messages,
      tokenStats,
    ],
  );

  const handleCommandExecute = useCallback(
    (index: number) => {
      const command = resolveCommand(index);
      handleCommand(command);
    },
    [resolveCommand, handleCommand],
  );

  // keep the file picker in sync with the current @mention token
  useEffect(() => {
    if (!activeMention) {
      setMentionCandidates([]);
      return;
    }
    let ignore = false;
    const loadCandidates = async () => {
      const nextCandidates = await getMentionCandidates(activeMention.query);
      if (ignore) return;

      setMentionCandidates(nextCandidates);
    };

    const handle = setTimeout(() => {
      void loadCandidates();
    }, 120);

    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [activeMention]);

  // Reset selection index and scroll offset when candidates update
  useEffect(() => {
    setMentionSelectedIndex(0);
    const timer = setTimeout(() => {
      mentionScrollRef.current?.scrollTo(0);
    }, 50);
    return () => clearTimeout(timer);
  }, [mentionCandidates]);

  // Wire up textarea submit handler once so it always reads the latest state.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.onSubmit = () => {
      onSubmitRef.current();
    };
  }, []);

  onSubmitRef.current = () => {
    if (disabled) return;

    if (showCommandMenu) {
      const command = resolveCommand(selectedIndex);
      handleCommand(command);
      return;
    }

    if (showMentionMenu) {
      const candidate = mentionCandidates[mentionSelectedIndex];
      if (candidate) {
        handleMentionExecute(mentionSelectedIndex);
        return;
      }
    }

    handleSubmit();
  };

  useKeyboard((key) => {
    if (disabled) return;
    if (!isTopLayer("base")) return;
    if (key.name === "tab") {
      key.preventDefault();
      toggleMode();
    }
  });

  useKeyboard((key) => {
    if (disabled) return;
    if (!showMentionMenu || !isTopLayer("mention")) return;
    if (key.name === "escape") {
      key.preventDefault();
      closeMentionMenu();
    } else if (key.name === "up") {
      key.preventDefault();
      setMentionSelectedIndex((currentIndex) => {
        const nextIndex = Math.max(0, currentIndex - 1);
        const scrollbox = mentionScrollRef.current;
        if (scrollbox && nextIndex < scrollbox.scrollTop) {
          scrollbox.scrollTo(nextIndex);
        }
        return nextIndex;
      });
    } else if (key.name === "down") {
      key.preventDefault();
      setMentionSelectedIndex((currentIndex) => {
        if (mentionCandidates.length === 0) {
          return 0;
        }

        const nextIndex = Math.min(
          mentionCandidates.length - 1,
          currentIndex + 1,
        );
        const scrollbox = mentionScrollRef.current;

        if (scrollbox) {
          const viewportHeight = scrollbox.viewport.height;
          const visibleEnd = scrollbox.scrollTop + viewportHeight - 1;
          if (nextIndex > visibleEnd) {
            scrollbox.scrollTo(nextIndex - viewportHeight + 1);
          }
        }

        return nextIndex;
      });
    }
  });

  // Register the base layer responder for ctrl+c dismissal
  useEffect(() => {
    setResponder("base", () => {
      if (disabled) return false;

      const textarea = textareaRef.current;
      if (textarea && textarea.plainText.length > 0) {
        textarea.setText("");
        return true;
      }
      return false;
    });

    return () => setResponder("base", null);
  }, [disabled, setResponder]);

  const modeColor =
    mode === Mode.PLAN
      ? colors.planMode
      : mode === Mode.AUTO
        ? colors.autoMode
        : colors.primary;
  // the reference TUI's prompt box is a subtle grey border by default; only Plan/Auto
  // tint it. The caret keeps the brand/mode colour.
  const borderColor = mode === Mode.BUILD ? colors.promptBorder : modeColor;

  return (
    <box width="100%" flexDirection="column">
      <box
        position="relative"
        border={["top", "bottom"]}
        borderColor={borderColor}
        width="100%"
        flexDirection="column"
        paddingX={1}
      >
        {showCommandMenu && (
          <box
            position="absolute"
            bottom="100%"
            left={0}
            width="100%"
            backgroundColor={colors.surface}
            zIndex={10}
          >
            <CommandMenu
              query={commandQuery}
              selectedIndex={selectedIndex}
              scrollRef={scrollRef}
              onSelect={setSelectedIndex}
              onExecute={handleCommandExecute}
            />
          </box>
        )}
        {!showCommandMenu && showMentionMenu && (
          <box
            position="absolute"
            bottom="100%"
            left={0}
            width="100%"
            backgroundColor={colors.surface}
            zIndex={10}
          >
            <FileMentionMenu
              candidates={mentionCandidates}
              selectedIndex={mentionSelectedIndex}
              scrollRef={mentionScrollRef}
              onSelect={setMentionSelectedIndex}
              onExecute={handleMentionExecute}
            />
          </box>
        )}
        <box flexDirection="row" alignItems="flex-start" width="100%">
          <text fg={modeColor}>❯ </text>
          <box flexGrow={1} flexShrink={1}>
            <textarea
              ref={textareaRef}
              focused={
                !disabled &&
                (isTopLayer("base") ||
                  isTopLayer("command") ||
                  isTopLayer("mention"))
              }
              keyBindings={TEXTAREA_KEY_BINDINGS}
              onContentChange={handleTextareaContentChange}
              placeholder={
                isCompacting
                  ? "Compacting context... please wait"
                  : disabled
                    ? "Choose an option above (↑/↓ · enter · esc)…"
                    : `Ask anything... "Fix a bug in the database"`
              }
            />
          </box>
        </box>
      </box>
      <box paddingX={1} width="100%">
        <StatusBar tokenStats={tokenStats} />
      </box>
    </box>
  );
}
