import { getOpenRouterApiKey } from "../credentials";

/**
 * First-run gate: onboarding is needed when no OpenRouter key resolves from the
 * environment or the credentials file. Mirrors resolveModel's key lookup so the
 * wizard runs exactly when inference would otherwise fail for lack of a key.
 */
export function isOnboardingNeeded(): boolean {
  return !getOpenRouterApiKey();
}
