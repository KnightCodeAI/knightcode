import { describe, expect, test } from "bun:test";
import { execute } from "./execute";

describe("Config executor", () => {
  test("unknown setting returns error", async () => {
    const out = (await execute({ setting: "nope" })) as any;
    expect(out.success).toBe(false);
    expect(out.error).toContain("Unknown setting");
  });

  test("invalid option is rejected on set", async () => {
    const out = (await execute({ setting: "theme", value: "rainbow" })) as any;
    expect(out.success).toBe(false);
    expect(out.error).toContain("Invalid value");
  });

  test("get returns operation get", async () => {
    const out = (await execute({ setting: "theme" })) as any;
    expect(out.success).toBe(true);
    expect(out.operation).toBe("get");
    expect(out.setting).toBe("theme");
  });
});
