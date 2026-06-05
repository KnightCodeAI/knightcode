import { describe, expect, test } from "bun:test";
import { tokenizeLine, type TokenKind } from "./highlight";

function kindsOf(line: string, lang = ""): Record<string, TokenKind> {
  const out: Record<string, TokenKind> = {};
  for (const t of tokenizeLine(line, lang)) {
    if (t.text.trim()) out[t.text.trim()] = t.kind;
  }
  return out;
}

describe("tokenizeLine", () => {
  test("keywords, strings, numbers, calls in JS", () => {
    const k = kindsOf('const x = foo("hi", 42);');
    expect(k["const"]).toBe("keyword");
    expect(k['"hi"']).toBe("string");
    expect(k["42"]).toBe("number");
    expect(k["foo"]).toBe("function");
  });

  test("line comment to end of line", () => {
    const toks = tokenizeLine("x = 1 // note");
    const comment = toks.find((t) => t.kind === "comment");
    expect(comment?.text).toBe("// note");
  });

  test("hash comment for python", () => {
    const toks = tokenizeLine("x = 1 # note", "py");
    expect(toks.some((t) => t.kind === "comment" && t.text === "# note")).toBe(
      true,
    );
  });

  test("literals flagged as boolean", () => {
    const k = kindsOf("return true;");
    expect(k["return"]).toBe("keyword");
    expect(k["true"]).toBe("boolean");
  });

  test("round-trips the original text", () => {
    const line = 'let s = `tpl ${x}` + 0xFF;';
    expect(tokenizeLine(line).map((t) => t.text).join("")).toBe(line);
  });
});
