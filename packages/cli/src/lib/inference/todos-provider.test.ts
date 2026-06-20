import { describe, expect, test } from "bun:test";
import { createTodosProvider } from "./todos-provider";
import type { Message } from "../engine/messages";

type Todo = {
  content: string;
  active_form: string;
  status: "pending" | "in_progress" | "completed";
};

/** A transcript with a single TodoWrite tool call carrying `todos`. */
function withTodos(todos: Todo[]): Message[] {
  return [
    {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-TodoWrite",
          toolCallId: "t1",
          state: "output-available",
          input: { todos },
          output: { success: true, todos },
        },
      ],
    },
  ] as unknown as Message[];
}

describe("todos provider", () => {
  test("is a per-round provider", () => {
    expect(createTodosProvider().phase).toBe("per_round");
  });

  test("emits nothing when no TodoWrite has run", async () => {
    const p = createTodosProvider();
    expect(await p.run({ messages: [], cwd: process.cwd() })).toEqual([]);
  });

  test("emits nothing when every todo is completed", async () => {
    const p = createTodosProvider();
    const messages = withTodos([
      { content: "A", active_form: "Doing A", status: "completed" },
      { content: "B", active_form: "Doing B", status: "completed" },
    ]);
    expect(await p.run({ messages, cwd: process.cwd() })).toEqual([]);
  });

  test("surfaces the current list once, then dedups until it changes", async () => {
    const p = createTodosProvider();
    const messages = withTodos([
      { content: "Write tests", active_form: "Writing tests", status: "in_progress" },
      { content: "Implement", active_form: "Implementing", status: "pending" },
    ]);

    const first = await p.run({ messages, cwd: process.cwd() });
    expect(first).toHaveLength(1);
    expect(first[0]).toContain("Writing tests"); // in_progress uses active_form
    expect(first[0]).toContain("Implement");

    // Unchanged list on the next round → deduped to nothing.
    expect(await p.run({ messages, cwd: process.cwd() })).toEqual([]);

    // The list changes (one item completed) → emits again.
    const changed = withTodos([
      { content: "Write tests", active_form: "Writing tests", status: "completed" },
      { content: "Implement", active_form: "Implementing", status: "in_progress" },
    ]);
    const third = await p.run({ messages: changed, cwd: process.cwd() });
    expect(third).toHaveLength(1);
    expect(third[0]).toContain("Implementing");
  });

  test("reads the most recent TodoWrite when several exist", async () => {
    const p = createTodosProvider();
    const messages = [
      ...withTodos([
        { content: "Old", active_form: "Old-ing", status: "pending" },
      ]),
      ...withTodos([
        { content: "New", active_form: "New-ing", status: "pending" },
      ]),
    ];
    const out = await p.run({ messages, cwd: process.cwd() });
    expect(out[0]).toContain("New");
    expect(out[0]).not.toContain("Old");
  });
});
