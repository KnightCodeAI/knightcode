export type TokenStats = {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  lastInputTokens?: number;
};

export type ContextSeverity = "ok" | "warn" | "crit";

export function formatContextWindow(
  lastInputTokens: number | undefined,
  contextLimit: number,
): { percentLeft: number; remainingK: string; limitK: string; severity: ContextSeverity } | null {
  if (lastInputTokens === undefined) return null;
  const remaining = Math.max(0, contextLimit - lastInputTokens);
  const percentLeft = Math.round((remaining / contextLimit) * 100);
  const severity: ContextSeverity =
    percentLeft <= 30 ? "crit" : percentLeft <= 50 ? "warn" : "ok";
  return {
    percentLeft,
    remainingK: (remaining / 1000).toFixed(0),
    limitK: (contextLimit / 1000).toFixed(0),
    severity,
  };
}
