import type { UIMessage } from "ai";

type ToolSearchMatch = { name?: unknown };
type ToolSearchOutput = { matches?: unknown };

function isToolSearchPart(part: { type?: string; toolName?: string }): boolean {
  if (part.type === "tool-ToolSearch") return true;
  if (part.type === "dynamic-tool" && part.toolName === "ToolSearch") {
    return true;
  }
  return false;
}

/**
 * Scan the message history for prior successful ToolSearch outputs and return
 * the union of tool names the model has discovered. Once loaded in a
 * conversation, a deferred tool stays loaded for subsequent turns.
 */
export function extractLoadedDeferredTools(
  messages: ReadonlyArray<UIMessage<any, any, any>>,
): Set<string> {
  const loaded = new Set<string>();
  for (const msg of messages) {
    const parts = (msg as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as {
        type?: string;
        toolName?: string;
        state?: string;
        output?: unknown;
      };
      if (!isToolSearchPart(p)) continue;
      if (p.state !== "output-available") continue;
      const output = p.output as ToolSearchOutput | undefined;
      if (!output || !Array.isArray(output.matches)) continue;
      for (const match of output.matches as ToolSearchMatch[]) {
        if (match && typeof match.name === "string") {
          loaded.add(match.name);
        }
      }
    }
  }
  return loaded;
}
