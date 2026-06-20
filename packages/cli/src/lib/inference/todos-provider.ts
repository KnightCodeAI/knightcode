import type { ContextProvider } from "../engine/context-providers";
import type { Message } from "../engine/messages";
import { debugLog } from "../debug";

type TodoStatus = "pending" | "in_progress" | "completed";
type Todo = { content: string; active_form: string; status: TodoStatus };

const TODO_STATUSES = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

/** Strict guard: every field used in rendering must be present and well-typed —
 *  `content` and `active_form` are strings and `status` is a known enum value.
 *  Anything looser would let render() emit `undefined` or an unhandled status. */
function isTodo(value: unknown): value is Todo {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Todo>;
  return (
    typeof t.content === "string" &&
    typeof t.active_form === "string" &&
    typeof t.status === "string" &&
    TODO_STATUSES.has(t.status)
  );
}

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
      if (Array.isArray(todos) && todos.every(isTodo)) return todos;
      return null; // a TodoWrite without a well-formed todo list — treat as none
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
      if (
        !todos ||
        todos.length === 0 ||
        todos.every((t) => t.status === "completed")
      ) {
        // Nothing to surface this round. Clear the dedup state so a later active
        // list is always re-surfaced, even if it matches one shown earlier.
        lastSignature = null;
        return [];
      }

      // Dedup on the rendered text itself: any change that alters what the model
      // would see — including an in_progress active_form edit — re-surfaces, and
      // the key can never drift from the message that's actually injected.
      const rendered = render(todos);
      if (rendered === lastSignature) {
        debugLog("context.todos", `unchanged (${todos.length}) - skip`);
        return [];
      }
      lastSignature = rendered;
      debugLog("context.todos", `injecting ${todos.length} todo(s)`);

      return [
        `Your current todo list (keep it updated as you work — mark items completed the moment they're done):\n${rendered}`,
      ];
    },
  };
}
