import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { proposedName, saveCopy } from "../../src/main/save-copy.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-save-copy-"));
	dirs.push(dir);
	return dir;
};

test("the proposed name is the last segment with Windows' reserved characters replaced", () => {
	expect(proposedName("C:\\repo\\src\\a.ts")).toBe("a.ts");
	expect(proposedName("/repo/src/what?.ts")).toBe("what_.ts");
	expect(proposedName("/repo/")).toBe("repo");
	expect(proposedName("/")).toBe("download");
});

test("a copy lands where chosen, nothing is written when cancelled or the file itself is chosen", async () => {
	const dir = scratch();
	const source = join(dir, "a.ts");
	writeFileSync(source, "one");
	let proposed = "";
	expect(await saveCopy(source, async (name) => ((proposed = name), join(dir, "copy.ts")))).toBe(join(dir, "copy.ts"));
	expect(proposed).toBe("a.ts");
	expect(readFileSync(join(dir, "copy.ts"), "utf8")).toBe("one");
	expect(await saveCopy(source, async () => undefined)).toBeUndefined();
	expect(await saveCopy(source, async () => source)).toBe(source);
	// No temporary file is left beside them.
	expect(readdirSync(dir).sort()).toEqual(["a.ts", "copy.ts"]);
});

test.skipIf(process.platform === "win32")("a copy over an existing file keeps that file's mode", async () => {
	const dir = scratch();
	writeFileSync(join(dir, "a.sh"), "new");
	writeFileSync(join(dir, "b.sh"), "old");
	chmodSync(join(dir, "b.sh"), 0o750);
	await saveCopy(join(dir, "a.sh"), async () => join(dir, "b.sh"));
	expect(readFileSync(join(dir, "b.sh"), "utf8")).toBe("new");
	expect(statSync(join(dir, "b.sh")).mode & 0o777).toBe(0o750);
});
