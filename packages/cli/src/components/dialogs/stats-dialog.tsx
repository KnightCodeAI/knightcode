import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { apiClient } from "../../lib/api-client";

type Stats = {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

export function StatsDialogContent() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.sessions.stats.$get();
        if (!res.ok) {
          setError(`Failed to load stats (HTTP ${res.status})`);
          return;
        }
        const data = await res.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <box flexDirection="column" gap={1}>
        <text attributes={TextAttributes.DIM}>Loading stats…</text>
      </box>
    );
  }

  if (error || !stats) {
    return (
      <box flexDirection="column" gap={1}>
        <text fg="red">{error ?? "Unknown error"}</text>
      </box>
    );
  }

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
        Usage statistics — all sessions
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
