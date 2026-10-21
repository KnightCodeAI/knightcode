/**
 * One way to run git and other tools (§6): a scrubbed environment, literal pathspecs, argument arrays, a process
 * group per child with an observable kill, a per-repository mutation queue, temporary-index snapshots and the one
 * machine-patch helper every applied patch comes from. Nothing here ever writes the user's real index.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AppServerError } from "./errors.ts";

export interface ProcessOptions {
	cwd: string;
	env?: Record<string, string>;
	input?: string | Buffer;
	/** Default 120 s. Expiry or abort kills the process group and waits for it to exit (at most 10 s more). */
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Default 64 MiB. Exceeding it kills the process and throws OutputTooLarge. */
	maxStdoutBytes?: number;
	/** stderr kept in ProcessResult: the last `stderrTailBytes` (default 64 KiB), never all of it. */
	stderrTailBytes?: number;
	/** false: stdout goes only to `onStdout` and is not collected, so `maxStdoutBytes` does not apply (setup). */
	collectStdout?: boolean;
	/** Per stdout chunk; return false to stop and kill (bounded counts). */
	onStdout?: (chunk: Buffer) => boolean | void;
	onStderr?: (chunk: Buffer) => void;
}

export interface ProcessResult {
	code: number | null;
	stdout: Buffer;
	stderr: string;
}

/** Timeout or abort; the process tree is confirmed gone. */
export class ProcessKilled extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProcessKilled";
	}
}

/** The tree could not be confirmed gone (taskkill failed, or the group outlived the wait). Callers keep their files. */
export class ProcessKillUnconfirmed extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProcessKillUnconfirmed";
	}
}

export class OutputTooLarge extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OutputTooLarge";
	}
}

export class GitError extends Error {
	readonly args: string[];
	readonly code: number | null;
	readonly stderr: string;

	constructor(args: string[], code: number | null, stderr: string) {
		super(`git ${args.join(" ")} exited with ${code}: ${stderr.trim().slice(-2000)}`);
		this.name = "GitError";
		this.args = args;
		this.code = code;
		this.stderr = stderr;
	}
}

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
]);
const WIN = process.platform === "win32";
const sameName = (a: string, b: string) => (WIN ? a.toUpperCase() === b.toUpperCase() : a === b);

function setEnv(env: NodeJS.ProcessEnv, name: string, value: string): void {
	for (const key of Object.keys(env)) if (sameName(key, name)) delete env[key];
	env[name] = value;
}

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		const name = WIN ? key.toUpperCase() : key;
		if (SCRUB.has(name) || /^GIT_CONFIG_(KEY|VALUE)_/.test(name)) continue;
		env[key] = value;
	}
	setEnv(env, "GIT_TERMINAL_PROMPT", "0");
	setEnv(env, "GIT_OPTIONAL_LOCKS", "0");
	setEnv(env, "GIT_LITERAL_PATHSPECS", "1");
	for (const [key, value] of Object.entries(extra)) setEnv(env, key, value);
	return env;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True when `closed` settles within `ms`. */
function within(closed: Promise<unknown>, ms: number): Promise<boolean> {
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([
		closed.then(() => true),
		new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms))),
	]).finally(() => clearTimeout(timer));
}

/** Kills the child's tree. True when it is confirmed gone; Windows can never confirm it (no Job Object in Node). */
async function killTree(child: ChildProcess, closed: Promise<void>): Promise<boolean> {
	const pid = child.pid;
	if (pid === undefined) return true;
	if (WIN) {
		// ponytail: a Job Object, through a native helper, would make Windows kills confirmable
		const taskkill = spawn(
			join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
			["/F", "/T", "/PID", String(pid)],
			{ stdio: "ignore", windowsHide: true },
		);
		await within(
			new Promise((resolve) => {
				taskkill.once("error", resolve);
				taskkill.once("close", resolve);
			}),
			3_000,
		);
		if (!(await within(closed, 3_000))) {
			child.stdout?.destroy();
			child.stderr?.destroy();
			child.stdin?.destroy();
			child.removeAllListeners();
		}
		return false;
	}
	// ponytail: setsid escapes the group; a cgroup would catch it
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
	}
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			process.kill(-pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
		}
		await delay(25);
	}
	return false;
}

/** Spawn with a scrubbed environment in its own process group; ENOENT becomes toolMissing naming `command`. */
export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
	const maxStdout = options.maxStdoutBytes ?? 64 * 1024 * 1024;
	const tailBytes = options.stderrTailBytes ?? 64 * 1024;
	const collect = options.collectStdout !== false;
	return new Promise((resolve, reject) => {
		let child: ChildProcess;
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				env: childEnv(options.env),
				windowsHide: true,
				detached: !WIN,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			reject(error);
			return;
		}
		const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
		const stdout: Buffer[] = [];
		let stdoutBytes = 0;
		let stderr = Buffer.alloc(0);
		let settled = false;
		let stopping = false;
		const cleanup = () => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
		};
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};
		const result = (code: number | null): ProcessResult => ({
			code,
			stdout: Buffer.concat(stdout),
			stderr: stderr.toString("utf8"),
		});
		/** Kill, then settle with `outcome` (an error class to throw, or a result to resolve with). */
		const stop = (why: string, outcome: "killed" | "tooLarge" | "stopped") => {
			if (stopping || settled) return;
			stopping = true;
			void killTree(child, closed).then((confirmed) => {
				if (outcome === "stopped") return finish(() => resolve(result(null)));
				if (outcome === "tooLarge")
					return finish(() => reject(new OutputTooLarge(`${command} printed more than ${maxStdout} bytes`)));
				finish(() =>
					reject(
						confirmed
							? new ProcessKilled(`${command} ${why}`)
							: new ProcessKillUnconfirmed(`${command} ${why}; its process tree could not be confirmed gone`),
					),
				);
			});
		};
		const onAbort = () => stop("was cancelled", "killed");
		const timer = setTimeout(() => stop("timed out", "killed"), options.timeoutMs ?? 120_000);
		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });

		child.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT" && existsSync(options.cwd))
				return finish(() => reject(new AppServerError("toolMissing", `${command} is not on PATH`)));
			finish(() => reject(error));
		});
		child.stdout!.on("data", (chunk: Buffer) => {
			if (stopping) return;
			if (collect) {
				stdoutBytes += chunk.length;
				if (stdoutBytes > maxStdout) return stop("", "tooLarge");
				stdout.push(chunk);
			}
			if (options.onStdout?.(chunk) === false) stop("", "stopped");
		});
		child.stderr!.on("data", (chunk: Buffer) => {
			options.onStderr?.(chunk);
			stderr = Buffer.concat([stderr, chunk]);
			if (stderr.length > tailBytes) stderr = stderr.subarray(stderr.length - tailBytes);
		});
		child.stdin!.on("error", () => {}); // a process that exits without reading its input
		child.stdin!.end(options.input ?? "");
		child.once("close", (code) => {
			if (!stopping) finish(() => resolve(result(code)));
		});
	});
}

export interface GitOptions extends Omit<ProcessOptions, "cwd"> {
	/** Server bookkeeping (snapshots, worktree add/remove, handoff steps): hooks and fsmonitor off. */
	internal?: boolean;
	/** Worktree population (Tasks 2, 9, 10): every configured filter emptied and Git LFS smudging off, so no user code runs. */
	noFilters?: boolean;
}

/** `GIT_CONFIG_COUNT` overrides that empty every configured filter driver; `-c` would split a name like `x=y`. */
async function filterOverrides(cwd: string, signal?: AbortSignal): Promise<Record<string, string>> {
	const listed = await runGit(cwd, ["config", "--null", "--name-only", "--get-regexp", "^filter\\."], { signal });
	const names = new Set<string>();
	for (const key of listed.stdout.toString("utf8").split("\0")) {
		const match = /^filter\.(.+)\.[^.]+$/s.exec(key);
		if (match) names.add(match[1]);
	}
	const env: Record<string, string> = { GIT_LFS_SKIP_SMUDGE: "1" };
	let i = 0;
	for (const name of names) {
		for (const [key, value] of [
			["process", ""],
			["clean", ""],
			["smudge", ""],
			["required", "false"],
		]) {
			env[`GIT_CONFIG_KEY_${i}`] = `filter.${name}.${key}`;
			env[`GIT_CONFIG_VALUE_${i}`] = value;
			i++;
		}
	}
	env.GIT_CONFIG_COUNT = String(i);
	return env;
}

/** Never throws on a non-zero exit code. Given a Repo, git runs at its root under its signal. */
export async function runGit(at: string | Repo, args: string[], options: GitOptions = {}): Promise<ProcessResult> {
	const { internal, noFilters, ...rest } = options;
	const cwd = typeof at === "string" ? at : at.root;
	// A caller's own signal adds to the repository's shutdown signal; it never replaces it.
	if (typeof at !== "string" && at.signal)
		rest.signal = rest.signal && rest.signal !== at.signal ? AbortSignal.any([rest.signal, at.signal]) : at.signal;
	const prefix = ["-c", "core.quotepath=false"];
	if (internal) prefix.push("-c", `core.hooksPath=${WIN ? "NUL" : "/dev/null"}`, "-c", "core.fsmonitor=");
	const env = noFilters ? { ...(await filterOverrides(cwd, rest.signal)), ...rest.env } : rest.env;
	return runProcess("git", [...prefix, ...args], { ...rest, cwd, env });
}

/** stdout as text with one trailing newline stripped; GitError on a non-zero exit. */
export async function git(at: string | Repo, args: string[], options?: GitOptions): Promise<string> {
	const result = await runGit(at, args, options);
	if (result.code !== 0) throw new GitError(args, result.code, result.stderr);
	return result.stdout.toString("utf8").replace(/\n$/, "");
}

export interface Repo {
	/** Canonical checkout root. */
	root: string;
	/** This checkout's git dir (a linked worktree has its own). */
	gitDir: string;
	/** Shared by every worktree of the repository. */
	commonDir: string;
	/** cwd relative to root, "/"-separated, "" at the root. */
	prefix: string;
	/** Every command runGit or git runs on this Repo gets it: a request's repo carries the manager's shutdown. */
	signal?: AbortSignal;
}

/** undefined outside a work tree. */
export async function repoOf(cwd: string, signal?: AbortSignal): Promise<Repo | undefined> {
	if (!existsSync(cwd)) return undefined;
	const result = await runGit(
		cwd,
		["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir", "--show-prefix"],
		{ signal },
	);
	if (result.code !== 0) return undefined;
	const [root, gitDir, commonDir, prefix = ""] = result.stdout.toString("utf8").split("\n");
	return {
		root: realpathSync.native(root),
		gitDir: realpathSync.native(gitDir),
		commonDir: realpathSync.native(commonDir),
		prefix: prefix.replace(/\/$/, ""),
		...(signal ? { signal } : {}),
	};
}

export async function requireRepo(cwd: string, signal?: AbortSignal): Promise<Repo> {
	const repo = await repoOf(cwd, signal);
	if (!repo) throw new AppServerError("notGitRepo", `${cwd} is not inside a git repository`);
	return repo;
}

let gitVersion: Promise<number[]> | undefined;
export async function gitAtLeast(major: number, minor: number): Promise<boolean> {
	gitVersion ??= git(tmpdir(), ["--version"]).then((text) => (/(\d+)\.(\d+)/.exec(text) ?? []).slice(1).map(Number));
	const [have, haveMinor] = await gitVersion;
	return have > major || (have === major && haveMinor >= minor);
}

const noop = () => {};
const repoLocks = new Map<string, Promise<unknown>>();
const lockKey = (repo: Repo) => (WIN ? repo.commonDir.toLowerCase() : repo.commonDir);

/** ponytail: in-process only; another process's git is caught by the preconditions each mutation re-checks. */
export function withRepoLock<T>(repo: Repo, fn: () => Promise<T>): Promise<T> {
	const key = lockKey(repo);
	const previous = repoLocks.get(key);
	// Free: start now, so a caller sees the operation begun in the same tick.
	const run = previous ? previous.then(noop, noop).then(fn) : (async () => fn())();
	repoLocks.set(key, run);
	const clear = () => {
		if (repoLocks.get(key) === run) repoLocks.delete(key);
	};
	run.then(clear, clear);
	return run;
}

const emptyTrees = new Map<string, Promise<string>>();
/** The empty tree in the repository's object format, written so later commands find it; memoized per commonDir. */
export function emptyTree(repo: Repo): Promise<string> {
	const key = lockKey(repo);
	let tree = emptyTrees.get(key);
	if (!tree) {
		tree = git(repo, ["hash-object", "-t", "tree", "-w", "--stdin"], { input: "" });
		tree.catch(() => emptyTrees.delete(key));
		emptyTrees.set(key, tree);
	}
	return tree;
}

/** emptyTree(repo) on an unborn branch. */
export async function headTree(repo: Repo): Promise<string> {
	const result = await runGit(repo, ["rev-parse", "-q", "--verify", "HEAD^{tree}"]);
	return result.code === 0 ? result.stdout.toString("utf8").trim() : emptyTree(repo);
}

/** Runs `fn` with a temporary copy of the index whose assume-unchanged and materialized skip-worktree flags are cleared. */
async function withTemporaryIndex<T>(
	repo: Repo,
	signal: AbortSignal | undefined,
	fn: (run: (args: string[], input?: string) => Promise<string>) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "kc-index-"));
	let keep = false;
	try {
		const index = join(dir, "index");
		const real = await git(repo, ["rev-parse", "--path-format=absolute", "--git-path", "index"], { signal });
		if (existsSync(real)) copyFileSync(real, index);
		const run = (args: string[], input?: string) =>
			git(repo, args, { internal: true, env: { GIT_INDEX_FILE: index }, input, signal });
		const flagged = (await run(["ls-files", "-v", "-z"]))
			.split("\0")
			.filter((entry) => /^[a-z] /.test(entry))
			.map((entry) => entry.slice(2));
		if (flagged.length > 0)
			await run(["update-index", "-z", "--no-assume-unchanged", "--stdin"], `${flagged.join("\0")}\0`);
		const materialized = (await run(["ls-files", "-t", "-z"]))
			.split("\0")
			.filter((entry) => entry.startsWith("S "))
			.map((entry) => entry.slice(2))
			.filter((path) => lstatSync(join(repo.root, path), { throwIfNoEntry: false }) !== undefined);
		if (materialized.length > 0)
			await run(["update-index", "-z", "--no-skip-worktree", "--stdin"], `${materialized.join("\0")}\0`);
		return await fn(run);
	} catch (error) {
		keep = error instanceof ProcessKillUnconfirmed;
		throw error;
	} finally {
		if (!keep) await rm(dir, { recursive: true, force: true });
	}
}

export function indexTree(repo: Repo, signal?: AbortSignal): Promise<string> {
	return withTemporaryIndex(repo, signal, (run) => run(["write-tree"]));
}

/**
 * The working tree's content as a tree: tracked files, plus untracked not ignored ones when `untracked`. With
 * `maxUntrackedBytes`, larger untracked files are left out, as Codex's turn snapshots leave out files over 10 MiB:
 * hashing them on every turn would stall it. Deletion and handoff snapshots never pass a limit.
 */
export function snapshotTree(
	repo: Repo,
	untracked: boolean,
	signal?: AbortSignal,
	maxUntrackedBytes?: number,
): Promise<string> {
	return withTemporaryIndex(repo, signal, async (run) => {
		// No pathspec: at the root it is the whole tree, and "." fails in a repository with no files at all.
		if (!untracked || maxUntrackedBytes === undefined) await run(["add", untracked ? "-A" : "-u"]);
		else {
			await run(["add", "-u"]);
			const small = (await run(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter((path) => {
				const info = lstatSync(join(repo.root, path), { throwIfNoEntry: false });
				return path !== "" && info !== undefined && info.size <= maxUntrackedBytes;
			});
			if (small.length > 0)
				await run(["add", "--pathspec-from-file=-", "--pathspec-file-nul"], `${small.join("\0")}\0`);
		}
		return run(["write-tree"]);
	});
}

/** Untracked files over this size are left out of turn snapshots and diff reads (Codex's default). */
export const LARGE_UNTRACKED_BYTES = 10 * 1024 * 1024;

/** Stops at limit + 1. */
export async function countUntracked(repo: Repo, limit: number, signal?: AbortSignal): Promise<number> {
	let count = 0;
	await runGit(repo, ["ls-files", "--others", "--exclude-standard", "-z"], {
		signal,
		collectStdout: false,
		onStdout: (chunk) => {
			for (const byte of chunk) if (byte === 0) count++;
			return count <= limit;
		},
	});
	return Math.min(count, limit + 1);
}

/** Raw bytes of a patch git itself can apply: no textconv, no external diff, fixed prefixes, whole repository. */
export async function machinePatch(
	repo: Repo,
	from: string,
	to: string,
	options: {
		paths?: string[];
		context?: number;
		binary?: boolean;
		ignoreWhitespace?: boolean;
		maxStdoutBytes?: number;
		signal?: AbortSignal;
	},
): Promise<Buffer> {
	const args = [
		...["-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "diff.relative=false"],
		...["-c", "diff.submodule=short", "-c", "diff.suppressBlankEmpty=false"],
		...["-c", "diff.outputIndicatorNew=+", "-c", "diff.outputIndicatorOld=-", "-c", "diff.outputIndicatorContext= "],
		...["-c", "color.ui=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--submodule=short"],
		...["--src-prefix=a/", "--dst-prefix=b/", "-O/dev/null", "-M", "--full-index"],
		...(options.binary ? ["--binary"] : []),
		...(options.ignoreWhitespace ? ["-w"] : []),
		`-U${options.context ?? 3}`,
		from,
		to,
		...(options.paths ? ["--", ...options.paths] : []),
	];
	const result = await runGit(repo, args, { signal: options.signal, maxStdoutBytes: options.maxStdoutBytes });
	if (result.code !== 0) throw new GitError(args, result.code, result.stderr);
	return result.stdout;
}

/** `git apply` of a machinePatch with every byte-changing or matching-relaxing option pinned off. */
export async function machineApply(
	at: string | Repo,
	patch: Buffer,
	options: { reverse?: boolean; cached?: boolean; check?: boolean; env?: Record<string, string>; signal?: AbortSignal },
): Promise<ProcessResult> {
	if (patch.length === 0) return { code: 0, stdout: Buffer.alloc(0), stderr: "" };
	return runGit(
		at,
		[
			...["-c", "apply.whitespace=nowarn", "-c", "apply.ignoreWhitespace=no", "apply", "--whitespace=nowarn"],
			...(options.reverse ? ["-R"] : []),
			...(options.cached ? ["--cached"] : []),
			...(options.check ? ["--check"] : []),
			"-",
		],
		{ input: patch, env: options.env, signal: options.signal },
	);
}

/** Paths whose old or new mode is a gitlink between two trees. */
export async function submodulePaths(repo: Repo, from: string, to: string, paths?: string[]): Promise<string[]> {
	const output = await git(repo, [
		...["-c", "diff.ignoreSubmodules=none", "diff", "--raw", "-z", "--no-renames", "--ignore-submodules=none"],
		...["-O/dev/null", from, to],
		...(paths ? ["--", ...paths] : []),
	]);
	const records = output.split("\0");
	const found: string[] = [];
	for (let i = 0; i + 1 < records.length; i += 2) {
		const [oldMode, newMode] = records[i].slice(1).split(" ");
		if (oldMode === "160000" || newMode === "160000") found.push(records[i + 1]);
	}
	return found;
}

/** path -> "<mode> <oid>" for the leaf entries of `tree` whose path is exactly a requested one. */
export async function entriesOf(repo: Repo, tree: string, paths: string[]): Promise<Map<string, string>> {
	const entries = new Map<string, string>();
	if (paths.length === 0) return entries;
	const wanted = new Set(paths);
	// ponytail: past 200 paths the whole tree is listed and filtered, so no argv outgrows Windows' 32 KiB limit.
	const args = paths.length > 200 ? ["ls-tree", "-r", "-z", tree] : ["ls-tree", "-z", tree, "--", ...paths];
	for (const record of (await git(repo, args)).split("\0")) {
		const tab = record.indexOf("\t");
		if (tab === -1) continue;
		const [mode, type, oid] = record.slice(0, tab).split(" ");
		const path = record.slice(tab + 1);
		if (type !== "tree" && wanted.has(path)) entries.set(path, `${mode} ${oid}`);
	}
	return entries;
}

/**
 * The working tree's entries for `paths` only: a temporary index stages just those paths, never hashing the rest of
 * the checkout's untracked files. A path neither on disk nor in the index stays absent.
 */
export async function currentEntries(repo: Repo, paths: string[], signal?: AbortSignal): Promise<Map<string, string>> {
	const tree = await withTemporaryIndex(repo, signal, async (run) => {
		const indexed = new Set((await run(["ls-files", "-z"])).split("\0"));
		// A parent replaced by a file (ENOTDIR) means the path is gone.
		const onDisk = (p: string) => {
			try {
				return lstatSync(join(repo.root, p), { throwIfNoEntry: false }) !== undefined;
			} catch {
				return false;
			}
		};
		const present = paths.filter((p) => indexed.has(p) || onDisk(p));
		// --force: a path ignored since the turn is still compared by what is on disk.
		if (present.length > 0)
			await run(["add", "-A", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"], `${present.join("\0")}\0`);
		return run(["write-tree"]);
	});
	return entriesOf(repo, tree, paths);
}

const OPERATIONS: [string, "merge" | "rebase" | "cherryPick" | "revert"][] = [
	["MERGE_HEAD", "merge"],
	["rebase-merge", "rebase"],
	["rebase-apply", "rebase"],
	["CHERRY_PICK_HEAD", "cherryPick"],
	["REVERT_HEAD", "revert"],
];

export function operationIn(repo: Repo): "merge" | "rebase" | "cherryPick" | "revert" | undefined {
	return OPERATIONS.find(([name]) => lstatSync(join(repo.gitDir, name), { throwIfNoEntry: false }))?.[1];
}

/**
 * Paths a checkout of other content would overwrite without git's own refusal: an untracked or ignored entry at a
 * written path, or a non-directory where a written path needs a directory. Git refuses untracked files itself but
 * silently overwrites ignored ones a branch tracks.
 */
export async function pathsInTheWay(repo: Repo, written: string[]): Promise<string[]> {
	if (written.length === 0) return [];
	const tracked = new Set((await git(repo, ["ls-files", "-z"])).split("\0").filter(Boolean));
	const blocked = new Set<string>();
	// ENOTDIR (a file where a directory would be) is "not there" for the path itself; its parent reports it.
	const lstat = (path: string) => {
		try {
			return lstatSync(join(repo.root, path), { throwIfNoEntry: false });
		} catch {
			return undefined;
		}
	};
	for (const path of written) {
		if (!tracked.has(path) && lstat(path)) blocked.add(path);
		for (let parent = dirname(path); parent !== "." && parent !== "/" && parent !== ""; parent = dirname(parent)) {
			const info = lstat(parent);
			if (info && !info.isDirectory() && !tracked.has(parent)) blocked.add(parent);
		}
	}
	return [...blocked];
}
