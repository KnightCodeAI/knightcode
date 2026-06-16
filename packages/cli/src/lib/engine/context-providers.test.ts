import { describe, expect, test } from "bun:test";
import {
  runContextProviders,
  latestUserText,
  type ContextProvider,
} from "./context-providers";
import type { Message } from "./messages";

const args = { messages: [] as Message[], cwd: "/x" };

describe("runContextProviders phase filtering", () => {
  test("runs only providers matching the requested phase", async () => {
    const calls: string[] = [];
    const providers: ContextProvider[] = [
      {
        phase: "turn_start",
        run: async () => {
          calls.push("ts");
          return ["start"];
        },
      },
      {
        phase: "per_round",
        run: async () => {
          calls.push("pr");
          return ["round"];
        },
      },
    ];

    const start = await runContextProviders(providers, "turn_start", args);
    expect(start).toEqual(["start"]);
    expect(calls).toEqual(["ts"]);

    const round = await runContextProviders(providers, "per_round", args);
    expect(round).toEqual(["round"]);
    expect(calls).toEqual(["ts", "pr"]);
  });

  test("swallows a throwing provider and drops empty strings", async () => {
    const providers: ContextProvider[] = [
      { phase: "per_round", run: async () => { throw new Error("boom"); } },
      { phase: "per_round", run: async () => ["", "  ", "keep"] },
    ];
    const out = await runContextProviders(providers, "per_round", args);
    expect(out).toEqual(["keep"]);
  });

  test("no matching providers → empty", async () => {
    const providers: ContextProvider[] = [
      { phase: "turn_start", run: async () => ["x"] },
    ];
    expect(await runContextProviders(providers, "per_round", args)).toEqual([]);
  });
});

describe("latestUserText", () => {
  test("joins the last user message's text parts", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "old" }] },
      { role: "assistant", parts: [{ type: "text", text: "reply" }] },
      {
        role: "user",
        parts: [
          { type: "text", text: "new" },
          { type: "tool-Read", toolCallId: "t", state: "output-available" },
        ],
      },
    ] as unknown as Message[];
    expect(latestUserText(messages)).toBe("new");
  });
});
