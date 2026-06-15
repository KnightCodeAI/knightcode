import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expandAtMentions, extractAtMentions } from "./at-mentions";

describe("extractAtMentions", () => {
  test("extracts plain mentions preceded by whitespace or start", () => {
    expect(extractAtMentions("@scripts and @src/index.ts please")).toEqual([
      "scripts",
      "src/index.ts",
    ]);
  });

  test("trailing slash and punctuation are not part of the path", () => {
    expect(extractAtMentions("look at @scripts/ now")).toEqual(["scripts"]);
    expect(extractAtMentions("read @a/b.ts, then stop")).toEqual(["a/b.ts"]);
  });

  test("quoted mentions capture paths with spaces", () => {
    expect(extractAtMentions('check @"my file.txt" please')).toEqual([
      "my file.txt",
    ]);
  });

  test("emails are not mentions", () => {
    expect(extractAtMentions("mail me at foo@bar.com")).toEqual([]);
  });

  test("deduplicates", () => {
    expect(extractAtMentions("@a.ts and @a.ts")).toEqual(["a.ts"]);
  });
});

describe("expandAtMentions", () => {
  test("directory mention becomes a listing; file mention becomes content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-mention-"));
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "build.ts"), "console.log('build');\n");
    writeFileSync(join(dir, "scripts", "pack.ts"), "console.log('pack');\n");

    const reminder = await expandAtMentions(
      "explain @scripts and @scripts/build.ts",
      dir,
    );
    expect(reminder).toContain("<system-reminder>");
    expect(reminder).toContain("Contents of directory @scripts:");
    expect(reminder).toContain("build.ts");
    expect(reminder).toContain("pack.ts");
    expect(reminder).toContain("Contents of file @scripts/build.ts:");
    expect(reminder).toContain("console.log('build');");
  });

  test("a large file is truncated, not loaded whole", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-mention-"));
    // ~500k chars of ASCII — well past the 40k cap.
    writeFileSync(join(dir, "big.txt"), "x".repeat(500_000));

    const reminder = await expandAtMentions("read @big.txt", dir);
    expect(reminder).toContain("Contents of file @big.txt:");
    expect(reminder).toContain("… (truncated; read the file for the rest)");
    // The emitted content must be capped near the char limit, not the full file.
    expect(reminder!.length).toBeLessThan(60_000);
  });

  test("a directory past the cap reports more entries without listing all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-mention-"));
    const many = join(dir, "many");
    mkdirSync(many);
    for (let i = 0; i < 1100; i++) {
      writeFileSync(join(many, `f${i}.txt`), "x");
    }
    const reminder = await expandAtMentions("list @many", dir);
    expect(reminder).toContain("Contents of directory @many:");
    expect(reminder).toContain("showing first 1000");
  });

  test("returns null when nothing resolves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kc-mention-"));
    expect(await expandAtMentions("@nope/missing.ts", dir)).toBeNull();
    expect(await expandAtMentions("no mentions here", dir)).toBeNull();
  });
});
