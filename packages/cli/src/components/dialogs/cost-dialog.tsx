import { TextAttributes } from "@opentui/core";
import { findSupportedChatModel } from "@knightcode/shared";

type Props = {
  tokenStats: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    lastInputTokens?: number;
  };
  model: string;
};

export function CostDialogContent({ tokenStats, model }: Props) {
  const modelDef = findSupportedChatModel(model);
  const contextLimit = modelDef?.contextWindow ?? 128000;
  const contextUsedPct = tokenStats.lastInputTokens
    ? Math.round((tokenStats.lastInputTokens / contextLimit) * 100)
    : 0;

  const rows: [string, string][] = [
    ["Input tokens", tokenStats.inputTokens.toLocaleString()],
    ["Output tokens", tokenStats.outputTokens.toLocaleString()],
    [
      "Total tokens",
      (tokenStats.inputTokens + tokenStats.outputTokens).toLocaleString(),
    ],
    [
      "Session cost",
      tokenStats.totalCost > 0 ? `$${tokenStats.totalCost.toFixed(6)}` : "Free",
    ],
    ...(tokenStats.lastInputTokens !== undefined
      ? ([
          [
            "Context window",
            `${tokenStats.lastInputTokens.toLocaleString()} / ${contextLimit.toLocaleString()} (${contextUsedPct}%)`,
          ],
        ] as [string, string][])
      : []),
    ["Model", model.replace(/:free$/, "")],
  ];

  return (
    <box flexDirection="column" gap={1} width="100%">
      {rows.map(([label, value]) => (
        <box key={label} flexDirection="row" gap={2}>
          <box width={18} flexShrink={0}>
            <text attributes={TextAttributes.DIM}>{label}</text>
          </box>
          <text>{value}</text>
        </box>
      ))}
    </box>
  );
}
