import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import { useKeyboardLayer } from "../keyboard-layer";

type VerboseContextValue = {
  /** When true, collapsed surfaces (tool outputs) render expanded. */
  verbose: boolean;
  toggleVerbose: () => void;
};

const VerboseContext = createContext<VerboseContextValue | null>(null);

export function useVerbose(): VerboseContextValue {
  const value = useContext(VerboseContext);
  if (!value) {
    throw new Error("useVerbose must be used within a VerboseProvider");
  }
  return value;
}

/**
 * Ctrl+O toggles a global "expanded view" (the reference TUI's transcript toggle):
 * tool outputs and other collapsed details render in full. Gated on the base
 * keyboard layer so it never fires inside a dialog or the onboarding wizard.
 */
export function VerboseProvider({ children }: { children: ReactNode }) {
  const [verbose, setVerbose] = useState(false);
  const { isTopLayer } = useKeyboardLayer();
  const toggleVerbose = useCallback(() => setVerbose((v) => !v), []);

  useKeyboard((key) => {
    if (!isTopLayer("base")) return;
    if (key.ctrl && key.name === "o") {
      key.preventDefault();
      toggleVerbose();
    }
  });

  const value = useMemo(
    () => ({ verbose, toggleVerbose }),
    [verbose, toggleVerbose],
  );

  return (
    <VerboseContext.Provider value={value}>{children}</VerboseContext.Provider>
  );
}
