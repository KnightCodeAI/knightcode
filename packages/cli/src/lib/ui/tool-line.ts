const MAX_LINE = 72;

function primaryArg(toolName: string, obj: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "Write":
      return String(obj.file_path ?? "");
    case "Bash":
      return String(obj.command ?? "");
    case "Grep":
      return `"${String(obj.pattern ?? "")}"`;
    case "Glob":
      return String(obj.pattern ?? "");
    case "WebFetch":
      return String(obj.url ?? "");
    case "WebSearch":
      return `"${String(obj.query ?? "")}"`;
    case "Agent":
      return String(obj.description ?? "");
    default:
      return "";
  }
}

/** the reference TUI's `ToolName(primaryArg)` call line, truncated to fit one line. */
export function toolCallLine(toolName: string, input: unknown): string {
  const obj =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const arg = primaryArg(toolName, obj).replace(/\s+/g, " ").trim();
  const inner = `${toolName}(${arg})`;
  if (inner.length <= MAX_LINE) return inner;
  // Truncate the arg, reserving room for `Name(` + `…)`.
  const keep = Math.max(0, MAX_LINE - toolName.length - 3);
  return `${toolName}(${arg.slice(0, keep)}…)`;
}

/** A short one-line result summary (the reference TUI's `⎿ Read 42 lines` etc.). */
export function toolResultSummary(
  toolName: string,
  _input: unknown,
  output: unknown,
  errorText?: string,
): string {
  if (errorText) return errorText;
  if (output == null) return "";
  let text: string;
  if (typeof output === "string") {
    text = output;
  } else {
    try {
      const json = JSON.stringify(output);
      text = typeof json === "string" ? json : "";
    } catch {
      text = "";
    }
  }
  const lines = text.split("\n");
  if (toolName === "Read") return `Read ${lines.length} lines`;
  const first = lines.find((l) => l.trim()) ?? "";
  return first.length > MAX_LINE ? first.slice(0, MAX_LINE - 1) + "…" : first;
}
