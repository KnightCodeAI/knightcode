import { TextAttributes } from "@opentui/core";
import { findSupportedChatModel } from "@knightcode/shared";
import type { Message } from "../../hooks/use-chat";

type Props = {
  sessionId: string;
  model: string;
  mode: string;
  messages: Message[];
  tokenStats?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    lastInputTokens?: number;
  };
};

export function StatusDialogContent({
  sessionId,
  model,
  mode,
  messages,
  tokenStats,
}: Props) {
  const modelDef = findSupportedChatModel(model);
  const contextLimit = modelDef?.contextWindow ?? 128000;

  const userMsgCount = messages.filter((m) => m.role === "user").length;
  const assistantMsgCount = messages.filter(
    (m) => m.role === "assistant",
  ).length;

  const contextPct = tokenStats?.lastInputTokens
    ? Math.round((tokenStats.lastInputTokens / contextLimit) * 100)
    : null;

  const rows: [string, string][] = [
    ["Session ID", sessionId.slice(0, 8) + "…"],
    ["Model", model.replace(/:free$/, "")],
    ["Mode", mode],
    ["User messages", String(userMsgCount)],
    ["AI messages", String(assistantMsgCount)],
    ...(tokenStats
      ? ([
          [
            "Cost",
            tokenStats.totalCost > 0
              ? `$${tokenStats.totalCost.toFixed(6)}`
              : "Free",
          ],
          [
            "Total tokens",
            (tokenStats.inputTokens + tokenStats.outputTokens).toLocaleString(),
          ],
        ] as [string, string][])
      : []),
    ...(contextPct !== null
      ? ([["Context used", `${contextPct}%`]] as [string, string][])
      : []),
  ];

  return (
    <box flexDirection="column" gap={1} width="100%">
      {rows.map(([label, value]) => (
        <box key={label} flexDirection="row" gap={2}>
          <box width={16} flexShrink={0}>
            <text attributes={TextAttributes.DIM}>{label}</text>
          </box>
          <text>{value}</text>
        </box>
      ))}
    </box>
  );
}
