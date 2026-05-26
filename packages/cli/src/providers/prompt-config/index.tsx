import {
  DEFAULT_CHAT_MODEL_ID,
  Mode,
  type ModeType,
  type ReasoningEffortLevel,
  type SupportedChatModelId,
} from "@knightcode/shared";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";
import {
  getRepoRoot,
  isWorktreeDisabled,
  setWorktreeDisabled as setWorktreeConfig,
} from "../../lib/worktree-tools";

type PromptConfigContextValue = {
  mode: ModeType;
  toggleMode: () => void;
  setMode: (mode: ModeType) => void;
  model: SupportedChatModelId;
  setModel: (model: SupportedChatModelId) => void;
  reasoningEffort: ReasoningEffortLevel;
  setReasoningEffort: (level: ReasoningEffortLevel) => void;
  worktreeDisabled: boolean;
  setWorktreeDisabled: (disabled: boolean) => void;
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
  const [model, setModel] = useState<SupportedChatModelId>(
    DEFAULT_CHAT_MODEL_ID,
  );
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortLevel>("medium");

  const repoRoot = getRepoRoot();
  const [worktreeDisabled, setWorktreeDisabledState] = useState(() => {
    return repoRoot ? isWorktreeDisabled(repoRoot) : true;
  });

  const setWorktreeDisabled = useCallback((disabled: boolean) => {
    const root = getRepoRoot();
    if (root) {
      setWorktreeConfig(root, disabled);
    }
    setWorktreeDisabledState(disabled);
  }, []);

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
        worktreeDisabled,
        setWorktreeDisabled,
      }}
    >
      {children}
    </PromptConfigContext.Provider>
  );
}
