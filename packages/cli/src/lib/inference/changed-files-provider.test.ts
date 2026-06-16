import { describe, expect, test } from "bun:test";
import { join } from "path";
import { createChangedFilesProvider } from "./changed-files-provider";
import { recordOriginalContent } from "../tools/shared/session-snapshot";

describe("changed-files provider", () => {
  test("is a per-round provider", () => {
    expect(createChangedFilesProvider().phase).toBe("per_round");
  });

  test("emits nothing with no sessionId or no changes", async () => {
    const p = createChangedFilesProvider();
    expect(await p.run({ messages: [], cwd: process.cwd() })).toEqual([]);
    expect(
      await p.run({ messages: [], cwd: process.cwd(), sessionId: "empty-sess" }),
    ).toEqual([]);
  });

  test("lists modified files once, then dedups until the set changes", async () => {
    const sessionId = `cf-test-${Date.now()}`;
    // Seed two "modified" files (non-existent paths record as null — fine).
    await recordOriginalContent(sessionId, join(process.cwd(), "a.ts"));
    await recordOriginalContent(sessionId, join(process.cwd(), "b.ts"));

    const p = createChangedFilesProvider();
    const first = await p.run({ messages: [], cwd: process.cwd(), sessionId });
    expect(first).toHaveLength(1);
    expect(first[0]).toContain("a.ts");
    expect(first[0]).toContain("b.ts");

    // Same set on the next round → deduped to nothing.
    const second = await p.run({ messages: [], cwd: process.cwd(), sessionId });
    expect(second).toEqual([]);

    // A new file changes the set → emits again.
    await recordOriginalContent(sessionId, join(process.cwd(), "c.ts"));
    const third = await p.run({ messages: [], cwd: process.cwd(), sessionId });
    expect(third).toHaveLength(1);
    expect(third[0]).toContain("c.ts");
  });
});
