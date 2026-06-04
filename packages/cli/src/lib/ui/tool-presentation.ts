// packages/cli/src/lib/ui/tool-presentation.ts

export type ToolStatus = "running" | "success" | "error";

/** Glyph shown next to a tool row for each status. */
export const STATUS_GLYPH: Record<ToolStatus, string> = {
  running: "…",
  success: "✓",
  error: "✗",
};

const SUMMARY_MAX = 120;

/** "TodoWrite" → "Todo Write"; leaves single words untouched. */
export function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= SUMMARY_MAX) return oneLine;
  return oneLine.slice(0, SUMMARY_MAX - 1) + "…";
}

/** A short, single-line description of what a tool call is doing. */
export function summarizeToolInput(toolName: string, input: unknown): string {
  if (input == null || typeof input !== "object") {
    return input == null ? "" : truncate(String(input));
  }
  const obj = input as Record<string, unknown>;

  switch (toolName) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return truncate(String(obj.file_path ?? "file"));
    case "Write": {
      const len = String(obj.content ?? "").length;
      return truncate(`${String(obj.file_path ?? "file")} (${len} chars)`);
    }
    case "Bash":
      return truncate(String(obj.command ?? ""));
    case "Grep":
    case "Glob":
      return truncate(String(obj.pattern ?? ""));
    case "WebFetch":
      return truncate(String(obj.url ?? ""));
    case "WebSearch":
      return truncate(String(obj.query ?? ""));
    case "Skill":
      return truncate(String(obj.command ?? obj.name ?? ""));
    case "Config":
      return truncate(String(obj.key ?? ""));
    case "Agent": {
      const sub = obj.subagent_type ? `${String(obj.subagent_type)} — ` : "";
      return truncate(`${sub}${String(obj.description ?? "")}`);
    }
    case "TodoWrite": {
      const todos = Array.isArray(obj.todos) ? obj.todos : [];
      const completed = todos.filter(
        (t: any) => t?.status === "completed",
      ).length;
      return `checklist (${completed}/${todos.length} completed)`;
    }
    default:
      return truncate(
        Object.values(obj)
          .map((v) =>
            v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v),
          )
          .filter(Boolean)
          .join(" "),
      );
  }
}

/** Derive a coarse status from an AI SDK tool part's `state`. */
export function toolStatus(part: { state?: string }): ToolStatus {
  if (part.state === "output-error") return "error";
  if (part.state === "output-available") return "success";
  return "running";
}
