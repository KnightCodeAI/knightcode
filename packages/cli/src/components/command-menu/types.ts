import type {
  ModeType,
  ReasoningEffortLevel,
  SupportedChatModelId,
} from "@knightcode/shared";
import type { DialogContextValue } from "../../providers/dialogs";
import type { ToastContextValue } from "../../providers/toast";

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
};

export type Command = {
  name: string;
  description: string;
  value: string;
  action?: (ctx: CommandContext) => void | Promise<void>;
};
