import { describe, expect, test } from "bun:test";
import { stringWidth } from "./stringWidth";

describe("stringWidth", () => {
  test("ascii", () => expect(stringWidth("hello")).toBe(5));
  test("CJK is double width", () => expect(stringWidth("你好")).toBe(4));
  test("ANSI escapes are zero width", () =>
    expect(stringWidth("[31mred[0m")).toBe(3));
});
