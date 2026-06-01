import {
  Mode,
  type ModeType,
  type ReasoningEffortLevel,
  type SupportedChatModelId,
} from "@knightcode/shared";
import { loadPreferredModel } from "../../lib/onboarding";
import { setSettingValue } from "../../lib/settings";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";

type PromptConfigContextValue = {
  mode: ModeType;
  toggleMode: () => void;
  setMode: (mode: ModeType) => void;
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
  const [mode, setMode] = useState<ModeType>(Mode.BUILD);
  const [model, setModelState] = useState<SupportedChatModelId>(() =>
    loadPreferredModel(),
  );
  const setModel = useCallback((next: SupportedChatModelId) => {
    setModelState(next);
    try {
      setSettingValue("model", next);
    } catch {
      // Persisting the preference is best-effort; a read-only home dir must not
      // break in-session model switching.
    }
  }, []);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortLevel>("medium");

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
