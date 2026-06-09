import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { findSupportedChatModel } from "@repo/shared";
import { getStore } from "../../lib/store/client";
import { directorySessionStats } from "../../lib/store";

type Stats = {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

function computeStats(): Stats {
  const rows = directorySessionStats(getStore(), process.cwd());
  let totalMessages = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  for (const r of rows) {
    totalMessages += r.messageCount;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    const def = r.model ? findSupportedChatModel(r.model) : undefined;
    if (def?.pricing) {
      totalCost +=
        (r.inputTokens / 1_000_000) * def.pricing.inputUsdPerMillionTokens +
        (r.outputTokens / 1_000_000) * def.pricing.outputUsdPerMillionTokens;
    }
  }
  return {
    totalSessions: rows.length,
    totalMessages,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
  };
}

export function StatsDialogContent() {
  const [stats] = useState<Stats>(computeStats);

  const rows: [string, string][] = [
    ["Sessions", stats.totalSessions.toLocaleString()],
    ["Total messages", stats.totalMessages.toLocaleString()],
    ["Input tokens", stats.totalInputTokens.toLocaleString()],
    ["Output tokens", stats.totalOutputTokens.toLocaleString()],
    [
      "Total tokens",
      (stats.totalInputTokens + stats.totalOutputTokens).toLocaleString(),
    ],
    [
      "Est. total cost",
      stats.totalCost > 0 ? `$${stats.totalCost.toFixed(4)}` : "Free",
    ],
  ];

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.BOLD}>
        Usage statistics — this directory
      </text>
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
