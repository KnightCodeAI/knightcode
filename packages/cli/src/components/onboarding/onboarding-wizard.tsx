import { MODEL_SHORTLIST, type SupportedChatModelId } from "@repo/shared";
import { RGBA, TextAttributes, type InputRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeOnboarding,
  isOnboardingNeeded,
  validateOpenRouterKey,
  type OnboardingSearchConfig,
} from "../../lib/onboarding";
import type { SearchProvider } from "../../lib/credentials";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { usePromptConfig } from "../../providers/prompt-config";
import { useTheme } from "../../providers/theme";
import { useToast } from "../../providers/toast";

type Step = "key" | "validating" | "model" | "search-provider" | "search-key";

type ProviderChoice = { label: string; value: SearchProvider | "skip" };

const PROVIDER_CHOICES: ProviderChoice[] = [
  { label: "Skip — I'll add web search later", value: "skip" },
  { label: "Brave Search", value: "brave" },
  { label: "Tavily", value: "tavily" },
];

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const dimensions = useTerminalDimensions();
  const { colors } = useTheme();
  const toast = useToast();
  const { setModel } = usePromptConfig();
  const { push, pop, isTopLayer } = useKeyboardLayer();

  const [step, setStep] = useState<Step>("key");
  const [apiKey, setApiKey] = useState("");
  const [model, setModelChoice] = useState<SupportedChatModelId | null>(null);
  const [provider, setProvider] = useState<SearchProvider | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [providerIndex, setProviderIndex] = useState(0);
  // Esc steps backward through the wizard. From the first ("key") step there's
  // nothing to go back to, so it cancels instead — but only on a /setup re-run;
  // a true first-run (no key yet) must be completed, so Esc is inert there.
  const [canCancel] = useState(() => !isOnboardingNeeded());

  const escHint =
    step === "validating"
      ? ""
      : step === "key"
        ? canCancel
          ? "esc cancel"
          : ""
        : "esc back";

  const keyInputRef = useRef<InputRenderable>(null);
  const searchKeyInputRef = useRef<InputRenderable>(null);

  // Own the top keyboard layer for the wizard's whole lifetime.
  useEffect(() => {
    push("onboarding");
    return () => pop("onboarding");
  }, [push, pop]);

  const persistAndFinish = useCallback(
    (search?: OnboardingSearchConfig) => {
      if (!model) return; // unreachable: model is set before this point
      completeOnboarding({ openRouterApiKey: apiKey, model, search });
      setModel(model);
      toast.show({ variant: "success", message: "KnightCode is configured." });
      onDone();
    },
    [apiKey, model, setModel, toast, onDone],
  );

  const submitKey = useCallback(async () => {
    const value = keyInputRef.current?.value?.trim() ?? "";
    setApiKey(value);
    setStep("validating");
    const result = await validateOpenRouterKey(value);
    if (result.status === "valid") {
      setStep("model");
      return;
    }
    if (result.status === "invalid") {
      toast.show({
        variant: "error",
        message: result.message ?? "That key was rejected. Try again.",
      });
      setStep("key");
      return;
    }
    // "error" (network / non-auth status): advisory only — let the user proceed.
    toast.show({
      variant: "info",
      message: `Couldn't reach OpenRouter (${result.message ?? "network error"}). Using the key anyway.`,
    });
    setStep("model");
  }, [toast]);

  useKeyboard((key) => {
    if (!isTopLayer("onboarding")) return;
    if (step === "validating") return; // keys are inert while a key is checked
    const isEnter = key.name === "return" || key.name === "enter";

    if (key.name === "escape") {
      // Step backward; from the first step, cancel (re-run only). List
      // highlights persist because modelIndex/providerIndex are kept in state.
      if (step === "model") setStep("key");
      else if (step === "search-provider") setStep("model");
      else if (step === "search-key") setStep("search-provider");
      else if (canCancel) onDone();
      return;
    }

    if (step === "key") {
      if (isEnter) void submitKey();
      return;
    }

    if (step === "model") {
      if (key.name === "up") setModelIndex((i) => Math.max(0, i - 1));
      else if (key.name === "down")
        setModelIndex((i) => Math.min(MODEL_SHORTLIST.length - 1, i + 1));
      else if (isEnter) {
        const chosen = MODEL_SHORTLIST[modelIndex]!;
        setModelChoice(chosen.id);
        setStep("search-provider");
      }
      return;
    }

    if (step === "search-provider") {
      if (key.name === "up") setProviderIndex((i) => Math.max(0, i - 1));
      else if (key.name === "down")
        setProviderIndex((i) => Math.min(PROVIDER_CHOICES.length - 1, i + 1));
      else if (isEnter) {
        const choice = PROVIDER_CHOICES[providerIndex]!;
        if (choice.value === "skip") {
          persistAndFinish();
        } else {
          setProvider(choice.value);
          setStep("search-key");
        }
      }
      return;
    }

    if (step === "search-key") {
      if (isEnter) {
        const value = searchKeyInputRef.current?.value?.trim() ?? "";
        if (value && provider) {
          persistAndFinish({ provider, apiKey: value });
        } else {
          // Empty key → treat as skip rather than persisting a blank search key.
          persistAndFinish();
        }
      }
    }
  });

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions.width}
      height={dimensions.height}
      justifyContent="center"
      alignItems="center"
      backgroundColor={RGBA.fromInts(0, 0, 0, 180)}
      zIndex={200}
    >
      <box
        width={Math.min(72, dimensions.width - 4)}
        height="auto"
        backgroundColor={colors.dialogSurface}
        paddingX={4}
        paddingY={2}
        flexDirection="column"
        gap={1}
      >
        <box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <text attributes={TextAttributes.BOLD}>Welcome to KnightCode</text>
          {escHint ? (
            <text attributes={TextAttributes.DIM}>{escHint}</text>
          ) : null}
        </box>

        {step === "key" && (
          <box flexDirection="column" gap={1}>
            <text>
              Paste your OpenRouter API key (from openrouter.ai/keys). Press
              Enter to continue.
            </text>
            <input ref={keyInputRef} placeholder="sk-or-..." focused />
          </box>
        )}

        {step === "validating" && <text>Validating key…</text>}

        {step === "model" && (
          <box flexDirection="column" gap={1}>
            <text>Pick a default model (↑/↓, Enter):</text>
            {MODEL_SHORTLIST.map((entry, i) => (
              <box
                key={entry.id}
                flexDirection="row"
                height={1}
                backgroundColor={
                  i === modelIndex ? colors.selection : undefined
                }
              >
                <text>
                  {i === modelIndex ? "❯ " : "  "}
                  {entry.label}
                </text>
              </box>
            ))}
          </box>
        )}

        {step === "search-provider" && (
          <box flexDirection="column" gap={1}>
            <text>Add web search? (optional — ↑/↓, Enter):</text>
            {PROVIDER_CHOICES.map((choice, i) => (
              <box
                key={choice.value}
                flexDirection="row"
                height={1}
                backgroundColor={
                  i === providerIndex ? colors.selection : undefined
                }
              >
                <text>
                  {i === providerIndex ? "❯ " : "  "}
                  {choice.label}
                </text>
              </box>
            ))}
          </box>
        )}

        {step === "search-key" && (
          <box flexDirection="column" gap={1}>
            <text>
              Paste your {provider} API key (Enter to finish, empty to skip):
            </text>
            <input ref={searchKeyInputRef} placeholder="search key" focused />
          </box>
        )}
      </box>
    </box>
  );
}
