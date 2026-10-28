import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

/** A fresh directory removed after the current test. */
export function useTempDirs(): () => string {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});
	return () => {
		const dir = mkdtempSync(join(tmpdir(), "kc-plugin-"));
		dirs.push(dir);
		return dir;
	};
}

/** Writes `files` (relative path → content; objects are written as JSON) under `root`. */
export function writeTree(root: string, files: Record<string, string | object>): string {
	for (const [path, content] of Object.entries(files)) {
		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content, null, 2));
	}
	return root;
}
