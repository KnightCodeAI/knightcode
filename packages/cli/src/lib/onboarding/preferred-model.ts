import {
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  type SupportedChatModelId,
} from "@repo/shared";
import { getSettingValue } from "../settings";

/**
 * The model the prompt config should start on: the persisted settings.json
 * `model`, but only if it's a known supported id (guards against a stale or
 * hand-edited value); otherwise the curated default.
 */
export function loadPreferredModel(): SupportedChatModelId {
  const stored = getSettingValue("model");
  if (typeof stored === "string" && findSupportedChatModel(stored)) {
    return stored as SupportedChatModelId;
  }
  return DEFAULT_CHAT_MODEL_ID;
}
