import type { ContextProvider } from "../engine/context-providers";
import type { Message } from "../engine/messages";
import { debugLog } from "../debug";

type TodoStatus = "pending" | "in_progress" | "completed";
type Todo = { content: string; active_form: string; status: TodoStatus };

/**
 * The most recent TodoWrite todo list in the transcript, or null if none yet.
 * TodoWrite is stateless (it just echoes its input), so the latest call's todos
 * ARE the current list. Scans newest-first and stops at the first TodoWrite.
 */
function latestTodos(messages: Message[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as {
        type?: string;
        input?: { todos?: unknown };
        output?: { todos?: unknown };
      };
      if (part?.type !== "tool-TodoWrite") continue;
      const todos = part.input?.todos ?? part.output?.todos;
      if (
        Array.isArray(todos) &&
        todos.every(
          (t): t is Todo =>
            !!t &&
            typeof (t as Todo).content === "string" &&
            typeof (t as Todo).status === "string",
        )
      ) {
        return todos as Todo[];
      }
      return null; // a TodoWrite without parsable todos — treat as none
    }
  }
  return null;
}

function render(todos: Todo[]): string {
  return todos
    .map((t) => {
      const box =
        t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
      // Match the active_form/content convention from the TodoWrite contract:
      // present-continuous while running, imperative otherwise.
      const label = t.status === "in_progress" ? t.active_form : t.content;
      return `- ${box} ${label}`;
    })
    .join("\n");
}

/**
 * A per-round context provider that re-surfaces the model's current todo list
 * near the end of context after each tool round. The system prompt never
 * re-injects live todo state, so as a turn grows the original TodoWrite call
 * scrolls far back; this keeps the active plan fresh. Self-gates: emits nothing
 * until a TodoWrite has run or once everything is completed, and dedups so an
 * unchanged list isn't re-sent every round (mirrors the changed-files provider).
 */
export function createTodosProvider(): ContextProvider {
  let lastSignature: string | null = null;
  return {
    phase: "per_round",
    run: async ({ messages }) => {
      const todos = latestTodos(messages);
      if (!todos || todos.length === 0) return [];
      if (todos.every((t) => t.status === "completed")) return [];

      const signature = todos.map((t) => `${t.status}:${t.content}`).join("\n");
      if (signature === lastSignature) {
        debugLog("context.todos", `unchanged (${todos.length}) - skip`);
        return [];
      }
      lastSignature = signature;
      debugLog("context.todos", `injecting ${todos.length} todo(s)`);

      return [
        `Your current todo list (keep it updated as you work — mark items completed the moment they're done):\n${render(
          todos,
        )}`,
      ];
    },
  };
}
