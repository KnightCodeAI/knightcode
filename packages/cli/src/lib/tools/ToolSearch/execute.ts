import {
  ToolSearch,
  getDeferredTools,
  type KnightcodeTool,
} from "@repo/shared";
import { z } from "zod";

export const tool: KnightcodeTool = ToolSearch;

function toJsonSchema(t: KnightcodeTool): unknown {
  try {
    // zod 4+ ships a top-level toJSONSchema converter; fall back to a minimal
    // shape if it's missing so the deferred-tool catalog still loads.
    const zAny = z as unknown as { toJSONSchema?: (s: unknown) => unknown };
    if (typeof zAny.toJSONSchema === "function") {
      return zAny.toJSONSchema(t.input_schema);
    }
  } catch {
    // fall through to fallback
  }
  return { type: "object", description: t.search_hint };
}

function scoreToolForKeywords(t: KnightcodeTool, terms: string[]): number {
  const haystack = `${t.name} ${t.search_hint} ${t.description}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const lower = term.toLowerCase();
    if (t.name.toLowerCase() === lower) score += 10;
    else if (t.name.toLowerCase().includes(lower)) score += 5;
    if (t.search_hint.toLowerCase().includes(lower)) score += 3;
    if (haystack.includes(lower)) score += 1;
  }
  return score;
}

export async function execute(input: unknown): Promise<unknown> {
  const { query, max_results } = ToolSearch.input_schema.parse(input);
  const deferred = getDeferredTools();

  let matches: KnightcodeTool[] = [];
  if (query.startsWith("select:")) {
    const requested = query
      .slice("select:".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    matches = deferred.filter((t) => requested.includes(t.name));
  } else {
    const terms = query.split(/\s+/).filter(Boolean);
    const requiredTerms = terms
      .filter((t) => t.startsWith("+"))
      .map((t) => t.slice(1).toLowerCase());
    const otherTerms = terms.filter((t) => !t.startsWith("+"));
    const candidates = deferred.filter((t) => {
      const haystack = `${t.name} ${t.search_hint}`.toLowerCase();
      return requiredTerms.every((req) => haystack.includes(req));
    });
    matches = candidates
      .map((t) => ({ t, score: scoreToolForKeywords(t, otherTerms) }))
      .filter((entry) => entry.score > 0 || requiredTerms.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max_results)
      .map((entry) => entry.t);
  }

  return {
    query,
    matches: matches.map((t) => ({
      name: t.name,
      description: t.description,
      search_hint: t.search_hint,
      input_schema: toJsonSchema(t),
      is_read_only: t.is_read_only,
    })),
    total_deferred_tools: deferred.length,
  };
}
