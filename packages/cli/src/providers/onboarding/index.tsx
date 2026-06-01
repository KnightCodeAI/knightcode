import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isOnboardingNeeded } from "../../lib/onboarding";

type OnboardingContextValue = {
  /** Whether the wizard overlay should be shown. */
  active: boolean;
  /** Open the wizard (re-run via /setup). */
  start: () => void;
  /** Close the wizard (called after a successful run or on cancel). */
  finish: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return value;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  // Evaluated once at mount: first run (no resolvable key) shows the wizard.
  const [active, setActive] = useState<boolean>(() => isOnboardingNeeded());

  const start = useCallback(() => setActive(true), []);
  const finish = useCallback(() => setActive(false), []);

  const value = useMemo(
    () => ({ active, start, finish }),
    [active, start, finish],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
