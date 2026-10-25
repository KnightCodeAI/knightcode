import type * as Fs from "node:fs";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { RotatingLog } from "../../src/main/log-file.ts";

// Windows refuses a rename onto a file another process holds open; nothing portable reproduces that, so refuse once.
const rename = vi.hoisted(() => ({ refuse: false }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof Fs>();
	return {
		...fs,
		renameSync: (from: Fs.PathLike, to: Fs.PathLike) => {
			if (rename.refuse) {
				rename.refuse = false;
				throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
			}
			fs.renameSync(from, to);
		},
	};
});

let dir: string | undefined;
afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

test("the log rolls over at its size into five files at most, newest first", () => {
	dir = mkdtempSync(join(tmpdir(), "kc-log-"));
	const path = join(dir, "logs", "app-server.log");
	const log = new RotatingLog(path, 10);
	for (let i = 0; i < 7; i++) log.write(`line ${i} ..\n`);
	log.write("open\n");
	log.end();
	expect(readFileSync(path, "utf8")).toBe("open\n");
	expect(readdirSync(join(dir, "logs")).sort()).toEqual([
		"app-server.log",
		"app-server.log.1",
		"app-server.log.2",
		"app-server.log.3",
		"app-server.log.4",
	]);
	expect(readFileSync(`${path}.1`, "utf8")).toBe("line 6 ..\n");
	expect(readFileSync(`${path}.4`, "utf8")).toBe("line 3 ..\n");
});

test("a log already past its size from an earlier run rolls over on the first write", () => {
	dir = mkdtempSync(join(tmpdir(), "kc-log-"));
	const path = join(dir, "app-server.log");
	writeFileSync(path, "earlier run\n");
	const log = new RotatingLog(path, 10);
	log.write("x\n");
	log.write("next\n");
	log.end();
	expect(readFileSync(path, "utf8")).toBe("next\n");
	expect(readFileSync(`${path}.1`, "utf8")).toBe("earlier run\nx\n");
	expect(existsSync(`${path}.2`)).toBe(false);
});

test("a refused rename (a file held elsewhere) does not throw, and the next write tries again", () => {
	dir = mkdtempSync(join(tmpdir(), "kc-log-"));
	const path = join(dir, "app-server.log");
	const log = new RotatingLog(path, 10);
	rename.refuse = true;
	expect(() => log.write("0123456789\n")).not.toThrow();
	expect(readFileSync(path, "utf8")).toBe("0123456789\n");
	log.write("after\n");
	log.end();
	expect(readFileSync(`${path}.1`, "utf8")).toBe("0123456789\nafter\n");
	expect(existsSync(path)).toBe(false);
});
