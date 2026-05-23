import { Mode } from "@knightcode/database/enums";
import {
  DEFAULT_CHAT_MODEL_ID,
  type SupportedChatModelId,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";

type PromptConfigContextValue = {
  mode: Mode;
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
  model: SupportedChatModelId;
  setModel: (model: SupportedChatModelId) => void;
  reasoningEffort: ReasoningEffortLevel;
  setReasoningEffort: (level: ReasoningEffortLevel) => void;
};

const PromptConfigContext = createContext<PromptConfigContextValue | null>(
  null,
);

export function usePromptConfig(): PromptConfigContextValue {
  const value = useContext(PromptConfigContext);
  if (!value) {
    throw new Error(
      "usePromptConfig must be used within a PromptConfigProvider",
    );
  }
  return value;
}

type PromptConfigProviderProps = {
  children: ReactNode;
};

export function PromptConfigProvider({ children }: PromptConfigProviderProps) {
  const [mode, setMode] = useState<Mode>(Mode.BUILD);
  const [model, setModel] = useState<SupportedChatModelId>(
    DEFAULT_CHAT_MODEL_ID,
  );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffortLevel>("medium");

  const toggleMode = useCallback(() => {
    setMode((m) => (m === Mode.BUILD ? Mode.PLAN : Mode.BUILD));
  }, []);

  return (
    <PromptConfigContext.Provider
      value={{
        mode,
        toggleMode,
        setMode,
        model,
        setModel,
        reasoningEffort,
        setReasoningEffort,
      }}
    >
      {children}
    </PromptConfigContext.Provider>
  );
}
