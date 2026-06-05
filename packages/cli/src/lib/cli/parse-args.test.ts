import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "./parse-args";

describe("parseCliArgs", () => {
  test("no args → tui", () => {
    expect(parseCliArgs([])).toEqual({ kind: "tui" });
  });
  test("--version / -v → version", () => {
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });
  test("doctor subcommand → doctor", () => {
    expect(parseCliArgs(["doctor"])).toEqual({ kind: "doctor" });
  });
  test("--version wins over doctor when both present", () => {
    expect(parseCliArgs(["doctor", "--version"])).toEqual({ kind: "version" });
  });
  test("unknown args → tui", () => {
    expect(parseCliArgs(["--whatever"])).toEqual({ kind: "tui" });
  });
});
