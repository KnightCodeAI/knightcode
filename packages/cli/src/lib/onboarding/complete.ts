import type { SupportedChatModelId } from "@knightcode/shared";
import { saveCredentials, type SearchProvider } from "../credentials";
import { setSettingValue } from "../settings";

export interface OnboardingSearchConfig {
  provider: SearchProvider;
  apiKey: string;
}

export interface OnboardingResult {
  openRouterApiKey: string;
  model: SupportedChatModelId;
  /** Optional BYO-key web search; omitted = WebSearch stays "not configured". */
  search?: OnboardingSearchConfig;
}

/**
 * Persist the wizard's result: secrets (OpenRouter key + optional search creds)
 * to credentials.json (0600), and the chosen default model to settings.json.
 *
 * Search creds are only written when a non-empty key is present — a blank key is
 * treated as "no search" at this boundary, so we never persist garbage that the
 * downstream WebSearch resolver would have to defend against.
 */
export function completeOnboarding(result: OnboardingResult): void {
  const trimmedSearchApiKey = result.search?.apiKey.trim();
  const search =
    trimmedSearchApiKey && result.search
      ? { provider: result.search.provider, apiKey: trimmedSearchApiKey }
      : undefined;
  saveCredentials({
    openRouterApiKey: result.openRouterApiKey,
    ...(search
      ? { searchProvider: search.provider, searchApiKey: search.apiKey }
      : {}),
  });
  setSettingValue("model", result.model);
}
