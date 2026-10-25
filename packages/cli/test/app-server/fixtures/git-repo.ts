import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The fixture is the test oracle, so it scrubs on its own (same list as git.ts's childEnv, written out again here) and
// reads no system or global git config: a user's core.hooksPath or an inherited GIT_OBJECT_DIRECTORY must not reach it.
const SCRUB = new Set([
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CEILING_DIRECTORIES",
	"GIT_CONFIG",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT",
	"GIT_OBJECT_DIRECTORY",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_GRAFT_FILE",
	"GIT_INDEX_FILE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_REPLACE_REF_BASE",
	"GIT_PREFIX",
	"GIT_SHALLOW_FILE",
	"GIT_COMMON_DIR",
	"GIT_EXTERNAL_DIFF",
	"GIT_DIFF_OPTS",
	"GIT_GLOB_PATHSPECS",
	"GIT_NOGLOB_PATHSPECS",
	"GIT_ICASE_PATHSPECS",
	"GIT_LITERAL_PATHSPECS",
]);
const scrubbed = (key: string) => SCRUB.has(key.toUpperCase()) || /^GIT_CONFIG_(KEY|VALUE)_/i.test(key);
const devNull = process.platform === "win32" ? "NUL" : "/dev/null";

export function shEnv(cwd: string, extra: Record<string, string>, ...args: string[]): string {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) if (!scrubbed(key)) env[key] = value;
	Object.assign(
		env,
		{ GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull },
		extra,
	);
	const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], { cwd, env, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.replace(/\n$/, "");
}

export const sh = (cwd: string, ...args: string[]) => shEnv(cwd, {}, ...args);
/** Like sh, but null on a non-zero exit (an unborn HEAD). */
export const trySh = (cwd: string, ...args: string[]): string | null => {
	try {
		return sh(cwd, ...args);
	} catch {
		return null;
	}
};

/** A repository at `dir` with one commit of `files` on `main`, a local identity and no signing. */
export function makeRepo(dir: string, files: Record<string, string> = { "a.txt": "one\ntwo\nthree\n" }): void {
	sh(dir, "init", "-q", "-b", "main");
	for (const [key, value] of [
		["user.name", "Test"],
		["user.email", "test@example.com"],
		["commit.gpgsign", "false"],
		["core.autocrlf", "false"],
	])
		sh(dir, "config", key, value);
	for (const [path, text] of Object.entries(files)) write(dir, path, text);
	sh(dir, "add", "-A");
	sh(dir, "commit", "-q", "-m", "initial");
}

export function write(dir: string, path: string, text: string): void {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), text);
}

const lstatSyncSafe = (path: string) => lstatSync(path, { throwIfNoEntry: false });

function fingerprint(path: string): string {
	const info = lstatSyncSafe(path);
	if (!info) return "missing";
	const mode = (info.mode & 0o777).toString(8); // Windows reports 666/444; enough to see a chmod on POSIX
	if (info.isSymbolicLink()) return `link:${mode}:${readlinkSync(path)}`;
	if (info.isDirectory()) return `dir:${mode}`;
	return `file:${mode}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/** Everything "unchanged" compares (Global Constraints). Never writes the real index; may add loose objects. */
export function checkoutState(dir: string) {
	const gitDir = sh(dir, "rev-parse", "--path-format=absolute", "--git-dir");
	const status = sh(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all");
	const files: Record<string, string> = {};
	const records = status.split("\0");
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record.length < 4) continue;
		const path = record.slice(3);
		if (record[0] === "R" || record[0] === "C") i++; // the next record is the source path
		files[path] = fingerprint(join(dir, path));
	}
	// Every tracked file by raw bytes and mode (test repositories are small), so an EOL-only or mode-only change shows
	// even where git's filters or core.fileMode would hide it.
	for (const path of sh(dir, "ls-files", "-z").split("\0")) if (path) files[path] = fingerprint(join(dir, path));
	// Ignored files one by one (not collapsed to their directory), so a changed or removed descendant shows.
	for (const path of sh(dir, "ls-files", "-z", "--others", "--ignored", "--exclude-standard").split("\0"))
		if (path) files[path] = fingerprint(join(dir, path));
	const operation = (name: string) => {
		const path = join(gitDir, name);
		return lstatSyncSafe(path)?.isFile() ? readFileSync(path, "utf8") : existsSync(path) ? "dir" : null;
	};
	// Tracked content through a temporary index with assume-unchanged cleared, so a flagged file that changed shows.
	// Writes objects only, never the real index.
	const temp = join(mkdtempSync(join(tmpdir(), "kc-fixture-")), "index");
	// A fresh repository may have no index (the temporary one then starts empty) and no HEAD (null below).
	const realIndex = sh(dir, "rev-parse", "--path-format=absolute", "--git-path", "index");
	if (existsSync(realIndex)) {
		copyFileSync(realIndex, temp);
		// Dated just after the epoch (0 turns git's check off), so every entry is racily clean and git compares content.
		// Otherwise the copy is newer than a same-size edit made within the second of the checkout, which git trusts.
		utimesSync(temp, 1, 1);
	}
	const env = { GIT_INDEX_FILE: temp };
	let trackedTree: string;
	try {
		const flagged = shEnv(dir, env, "ls-files", "-v", "-z")
			.split("\0")
			.filter((e) => /^[a-z] /.test(e));
		for (const entry of flagged) shEnv(dir, env, "update-index", "--no-assume-unchanged", "--", entry.slice(2));
		shEnv(dir, env, "add", "-u"); // no pathspec: "." fails in a repository with no files
		trackedTree = shEnv(dir, env, "write-tree");
	} finally {
		rmSync(dirname(temp), { recursive: true, force: true });
	}
	return {
		head: trySh(dir, "rev-parse", "-q", "--verify", "HEAD"), // null on an unborn branch
		trackedTree,
		index: sh(dir, "ls-files", "-s", "-z"), // mode, blob and stage of every entry; unresolved stages included
		status,
		files,
		operations: Object.fromEntries(
			["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "AUTO_MERGE", "rebase-merge", "rebase-apply"].map((n) => [
				n,
				operation(n),
			]),
		),
	};
}
