import { describe, expect, test } from "bun:test";
import { splitMarkdownBlocks } from "./split-blocks";

describe("splitMarkdownBlocks", () => {
  test("separates prose and fenced code with language", () => {
    const blocks = splitMarkdownBlocks(
      "Here:\n\n```ts\nconst x = 1;\n```\n\nDone",
    );
    expect(blocks).toEqual([
      { type: "prose", text: "Here:\n" },
      { type: "code", code: "const x = 1;", lang: "ts" },
      { type: "prose", text: "\nDone" },
    ]);
  });

  test("no code blocks → single prose block", () => {
    const blocks = splitMarkdownBlocks("# Title\n\njust text");
    expect(blocks).toEqual([{ type: "prose", text: "# Title\n\njust text" }]);
  });

  test("fence without language", () => {
    const blocks = splitMarkdownBlocks("```\nplain\n```");
    expect(blocks).toEqual([{ type: "code", code: "plain", lang: "" }]);
  });

  test("unterminated fence (streaming) becomes code to EOF", () => {
    const blocks = splitMarkdownBlocks("```py\ndef f():\n    pass");
    expect(blocks).toEqual([
      { type: "code", code: "def f():\n    pass", lang: "py" },
    ]);
  });
});
