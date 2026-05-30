import type {
  ModeType,
  ReasoningEffortLevel,
  SupportedChatModelId,
} from "@knightcode/shared";
import type { DialogContextValue } from "../../providers/dialogs";
import type { ToastContextValue } from "../../providers/toast";
import type { Message } from "../../hooks/use-chat";

export type CommandContext = {
  exit: () => void;
  toast: ToastContextValue;
  dialog: DialogContextValue;
  navigate: (path: string) => void;
  mode: ModeType;
  setMode: (mode: ModeType) => void;
  model: SupportedChatModelId;
  setModel: (model: SupportedChatModelId) => void;
  reasoningEffort: ReasoningEffortLevel;
  setReasoningEffort: (level: ReasoningEffortLevel) => void;
  sessionId?: string;
  compact?: () => void | Promise<void>;
  messages?: Message[];
  tokenStats?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    lastInputTokens?: number;
  };
  clearMessages?: () => Promise<void>;
  rewindMessages?: (n: number) => Promise<void>;
  submitMessage?: (text: string) => void;
  submitCommand?: (text: string, progressMessage: string) => void;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  argumentHint?: string;
  action?: (ctx: CommandContext) => void | Promise<void>;
};
