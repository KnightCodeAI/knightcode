import { generateText } from "ai";
import { resolveModel } from "./resolve-model";
import { getSettingValue } from "../settings";

/**
 * Resolve which model to use for cheap background "side queries" (memory
 * recall/extraction, skill discovery). Honors the `sideQueryModel` setting;
 * falls back to the caller's main model so a BYOK user always has a model their
 * OpenRouter key can actually reach.
 */
export function resolveSideQueryModelId(mainModelId: string): string {
  const configured = getSettingValue("sideQueryModel");
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : mainModelId;
}

export type SideQueryParams = {
  system: string;
  prompt: string;
  /** The turn's main model; used when `sideQueryModel` is unset. */
  mainModelId: string;
  getApiKey?: () => string | undefined;
  signal?: AbortSignal;
  maxOutputTokens?: number;
};

/**
 * One-shot, tool-free model call for background reasoning. Never throws into the
 * caller's turn — returns "" on any failure so a flaky/absent side model can't
 * break the main loop. Reasoning is forced low: selection/extraction don't
 * benefit from extended thinking, and it keeps the call cheap.
 */
export async function sideQuery(params: SideQueryParams): Promise<string> {
  try {
    const modelId = resolveSideQueryModelId(params.mainModelId);
    const resolved = resolveModel(modelId, "low", {
      getApiKey: params.getApiKey,
    });
    const { text } = await generateText({
      model: resolved.model,
      system: params.system,
      prompt: params.prompt,
      providerOptions: resolved.providerOptions,
      abortSignal: params.signal,
      ...(params.maxOutputTokens
        ? { maxOutputTokens: params.maxOutputTokens }
        : {}),
    });
    return text ?? "";
  } catch {
    return "";
  }
}
