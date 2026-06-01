import { Outlet } from "react-router";
import { DialogProvider } from "../providers/dialogs";
import { KeyboardLayerProvider } from "../providers/keyboard-layer";
import { OnboardingProvider, useOnboarding } from "../providers/onboarding";
import { PromptConfigProvider } from "../providers/prompt-config";
import { ThemeProvider } from "../providers/theme";
import { ToastProvider } from "../providers/toast";
import { TodoProvider } from "../providers/todo";
import { OnboardingWizard } from "../components/onboarding/onboarding-wizard";
import { ThemedRoot } from "./themed-root";

function RoutedContent() {
  const { active, finish } = useOnboarding();
  return (
    <>
      <Outlet />
      {active && <OnboardingWizard onDone={finish} />}
    </>
  );
}

export function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <KeyboardLayerProvider>
          <DialogProvider>
            <PromptConfigProvider>
              <TodoProvider>
                <OnboardingProvider>
                  <ThemedRoot>
                    <RoutedContent />
                  </ThemedRoot>
                </OnboardingProvider>
              </TodoProvider>
            </PromptConfigProvider>
          </DialogProvider>
        </KeyboardLayerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
