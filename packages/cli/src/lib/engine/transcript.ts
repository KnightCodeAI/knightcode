import type { Message } from "./messages";

const UNRESOLVED_STATES = new Set(["input-streaming", "input-available"]);

function isToolPart(part: unknown): part is {
  type: string;
  state?: string;
  toolCallId?: string;
} {
  if (!part || typeof part !== "object") return false;
  const type = (part as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    (type === "dynamic-tool" || type.startsWith("tool-"))
  );
}

export const INTERRUPTED_TOOL_ERROR =
  "Tool execution was interrupted before completing.";

/**
 * Guarantee transcript integrity before a request: strip empty assistant
 * shells and resolve any tool call that never received a result into an
 * output-error part, marking the message interrupted. Healthy messages are
 * returned by reference (cheap no-op for clean transcripts).
 */
export function repairTranscript(messages: Message[]): Message[] {
  return messages
    .filter((m) => !(m.role === "assistant" && m.parts.length === 0))
    .map((m) => {
      if (m.role !== "assistant") return m;
      let repaired = false;
      const parts = m.parts.map((part) => {
        if (isToolPart(part) && UNRESOLVED_STATES.has(part.state ?? "")) {
          repaired = true;
          return {
            ...(part as object),
            state: "output-error",
            errorText: INTERRUPTED_TOOL_ERROR,
          };
        }
        return part;
      });
      if (!repaired) return m;
      return {
        ...m,
        parts: parts as Message["parts"],
        metadata: { ...m.metadata, isInterrupted: true },
      };
    });
}
