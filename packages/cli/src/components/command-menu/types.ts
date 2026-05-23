import type { Mode } from "@knightcode/database/enums";
import type { DialogContextValue } from "../../providers/dialogs";
import type { ToastContextValue } from "../../providers/toast";
import type { SupportedChatModelId } from "@knightcode/shared";

export type CommandContext = {
  exit: () => void;
  toast: ToastContextValue;
  dialog: DialogContextValue;
  navigate: (path: string) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  model: SupportedChatModelId;
  setModel: (model: SupportedChatModelId) => void;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  action?: (ctx: CommandContext) => void | Promise<void>;
};
