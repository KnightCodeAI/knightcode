import { describe, expect, test } from "bun:test";
import { getToolContractsByNames } from "./index";

describe("getToolContractsByNames", () => {
  test("returns contracts for named tools, including normally-deferred ones", () => {
    const tools = getToolContractsByNames(["Read", "WebFetch"]);
    expect(tools["Read"]).toBeDefined();
    expect(tools["WebFetch"]).toBeDefined(); // deferred, but explicitly named
    expect(tools["Bash"]).toBeUndefined();
  });

  test("ignores unknown names", () => {
    const tools = getToolContractsByNames(["Read", "Nope"]);
    expect(tools["Read"]).toBeDefined();
    expect(tools["Nope"]).toBeUndefined();
  });
});
