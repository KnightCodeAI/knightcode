import {
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  resolveModelAlias,
  type SupportedChatModelId,
} from "@repo/shared";

export type ResolveSubagentModelArgs = {
  /** Raw OpenRouter id chosen by the user at spawn-confirm time. */
  override?: string;
  /** The Agent tool's `model` alias arg (model-chosen). */
  aliasArg?: string;
  /** The agent definition's `model` ("inherit" | alias | undefined). */
  agentModel?: string;
};

/**
 * Precedence: user per-spawn override (raw id, must be a known model) >
 * tool alias arg > agent default alias (unless "inherit") > global default.
 */
export function resolveSubagentModel(
  args: ResolveSubagentModelArgs,
): SupportedChatModelId {
  if (args.override && findSupportedChatModel(args.override)) {
    return args.override as SupportedChatModelId;
  }
  const fromAlias = args.aliasArg && resolveModelAlias(args.aliasArg);
  if (fromAlias) return fromAlias;
  const fromAgent =
    args.agentModel &&
    args.agentModel !== "inherit" &&
    resolveModelAlias(args.agentModel);
  if (fromAgent) return fromAgent;
  return DEFAULT_CHAT_MODEL_ID;
}
