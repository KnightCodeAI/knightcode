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

  // Violation #3: an active_form-only change must re-surface, since render shows
  // active_form for the in_progress item.
  test("re-surfaces when only the in_progress active_form changes", async () => {
    const p = createTodosProvider();
    const first = await p.run({
      messages: withTodos([
        { content: "Build", active_form: "Building", status: "in_progress" },
      ]),
      cwd: process.cwd(),
    });
    expect(first[0]).toContain("Building");

    const second = await p.run({
      messages: withTodos([
        { content: "Build", active_form: "Compiling", status: "in_progress" },
      ]),
      cwd: process.cwd(),
    });
    expect(second).toHaveLength(1);
    expect(second[0]).toContain("Compiling");
  });

  // Violation #2: going all-completed must clear dedup state, so a later active
  // list is re-surfaced even if it matches a previously-shown one.
  test("re-surfaces an active list after a fully-completed round", async () => {
    const p = createTodosProvider();
    const active = withTodos([
      { content: "Task", active_form: "Doing task", status: "pending" },
    ]);

    const first = await p.run({ messages: active, cwd: process.cwd() });
    expect(first).toHaveLength(1);

    // All done → nothing emitted.
    const done = withTodos([
      { content: "Task", active_form: "Doing task", status: "completed" },
    ]);
    expect(await p.run({ messages: done, cwd: process.cwd() })).toEqual([]);

    // Re-opened to the SAME signature as the first list → must emit again.
    const reopened = await p.run({ messages: active, cwd: process.cwd() });
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toContain("Task");
  });

  // Violation #1: malformed todos (out-of-enum status, missing active_form) are
  // rejected — the provider treats the list as none rather than rendering junk.
  test("ignores a malformed todo list", async () => {
    const raw = (todos: unknown[]): Message[] =>
      [
        {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-TodoWrite",
              toolCallId: "t1",
              state: "output-available",
              input: { todos },
            },
          ],
        },
      ] as unknown as Message[];

    const p = createTodosProvider();
    // bogus status
    expect(
      await p.run({
        messages: raw([{ content: "X", active_form: "Xing", status: "doing" }]),
        cwd: process.cwd(),
      }),
    ).toEqual([]);
    // missing active_form
    expect(
      await p.run({
        messages: raw([{ content: "Y", status: "in_progress" }]),
        cwd: process.cwd(),
      }),
    ).toEqual([]);
  });
});
