/**
 * Diffs (§6.2): the scopes of Codex's Changes pane as pairs of trees, read through the one machine patch, split
 * into files and hunks with content-hash ids, and kept within a response budget.
 */

import { createHash } from "node:crypto";
import type { DiffFile, DiffHunk, DiffScope, ParamsOf, ResultOf } from "@knightcode/app-server-protocol";
import type { SessionEntry } from "../core/session-manager.ts";
import { AppServerError } from "./errors.ts";
import {
	countUntracked,
	emptyTree,
	git,
	headTree,
	indexTree,
	machinePatch,
	OutputTooLarge,
	type Repo,
	requireRepo,
	runGit,
	snapshotTree,
} from "./git.ts";
import type { LoadedThread } from "./loaded-thread.ts";

/** The custom entry a turn's change detection writes (Task 6): the working tree's content before and after the turn. */
export const TURN_DIFF_ENTRY = "knightcode.turnDiff";
export interface TurnDiffRecord {
	turnId: string;
	before: string;
	after: string;
}

export interface ScopeTrees {
	from: string;
	to: string;
	untrackedSkipped?: number;
	turnId?: string;
	stale?: boolean;
	against?: string;
}

export interface DiffBudgets {
	/** Running total of serialized files with hunks. */
	serialized: number;
	/** Running total once files go metadata only; past it the rest are counted, not listed. */
	metadata: number;
}
export const DEFAULT_DIFF_BUDGETS: DiffBudgets = { serialized: 24 * 1024 * 1024, metadata: 32 * 1024 * 1024 };

const UNTRACKED_LIMIT = 500;
const PATCH_LIMIT = 16 * 1024 * 1024;
const FILE_PATCH_LIMIT = 512 * 1024;

/** The working tree's content: untracked files included unless more than 500 of them would be. */
export async function workingTree(
	repo: Repo,
	signal?: AbortSignal,
): Promise<{ tree: string; untrackedSkipped?: number }> {
	if ((await countUntracked(repo, UNTRACKED_LIMIT, signal)) <= UNTRACKED_LIMIT)
		return { tree: await snapshotTree(repo, true, signal) };
	return {
		tree: await snapshotTree(repo, false, signal),
		untrackedSkipped: await countUntracked(repo, 999_999, signal),
	};
}

/** The newest turn change record on the thread's branch. */
export function lastTurnDiff(entries: readonly SessionEntry[]): TurnDiffRecord | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === TURN_DIFF_ENTRY) return entry.data as TurnDiffRecord;
	}
	return undefined;
}

async function resolveCommit(repo: Repo, ref: string): Promise<string | undefined> {
	const result = await runGit(repo.root, ["rev-parse", "--verify", "-q", "--end-of-options", `${ref}^{commit}`]);
	return result.code === 0 ? result.stdout.toString("utf8").trim() : undefined;
}

const treeOf = (repo: Repo, commit: string) => git(repo.root, ["rev-parse", "--verify", `${commit}^{tree}`]);

/** The crate's default_worktree_base: the remote HEAD (origin first), then origin/main, origin/master, main, master. */
async function defaultBranch(repo: Repo): Promise<string | undefined> {
	const remotes = (await git(repo.root, ["remote"])).split("\n").filter(Boolean);
	remotes.sort((a, b) => (a === "origin" ? -1 : b === "origin" ? 1 : 0));
	for (const remote of remotes) {
		const head = await runGit(repo.root, ["symbolic-ref", "-q", "--short", `refs/remotes/${remote}/HEAD`]);
		if (head.code === 0) return head.stdout.toString("utf8").trim();
	}
	for (const candidate of ["origin/main", "origin/master", "main", "master"])
		if (await resolveCommit(repo, candidate)) return candidate;
	return undefined;
}

export async function scopeTrees(
	thread: LoadedThread,
	repo: Repo,
	selector: { scope: DiffScope; against?: string; commit?: string },
): Promise<ScopeTrees> {
	switch (selector.scope) {
		case "lastTurn": {
			const record = lastTurnDiff(thread.session.sessionManager.getBranch());
			if (!record) return { from: "", to: "" };
			for (const tree of [record.before, record.after]) {
				const exists = await runGit(repo.root, ["cat-file", "-e", tree]);
				if (exists.code !== 0) return { from: "", to: "", turnId: record.turnId, stale: true };
			}
			return { from: record.before, to: record.after, turnId: record.turnId };
		}
		case "uncommitted": {
			const { tree, untrackedSkipped } = await workingTree(repo);
			return { from: await headTree(repo), to: tree, untrackedSkipped };
		}
		case "unstaged": {
			const { tree, untrackedSkipped } = await workingTree(repo);
			return { from: await indexTree(repo), to: tree, untrackedSkipped };
		}
		case "staged":
			return { from: await headTree(repo), to: await indexTree(repo) };
		case "committed": {
			if (!selector.commit) throw new AppServerError("invalidParams", "the committed scope needs a commit");
			const commit = await resolveCommit(repo, selector.commit);
			if (!commit) throw new AppServerError("invalidParams", `no commit ${selector.commit}`);
			const parent = await resolveCommit(repo, `${commit}^1`);
			return { from: parent ? await treeOf(repo, parent) : await emptyTree(repo), to: await treeOf(repo, commit) };
		}
		case "branch": {
			let against = selector.against;
			const workspace = thread.workspace;
			if (against === undefined && workspace.mode === "worktree") against = workspace.baseRef;
			if (against === undefined) {
				const upstream = await runGit(repo.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
				if (upstream.code === 0) against = upstream.stdout.toString("utf8").trim();
			}
			against ??= await defaultBranch(repo);
			if (against === undefined) throw new AppServerError("invalidParams", "no branch to compare with: pass `against`");
			const base = await resolveCommit(repo, against);
			if (!base) throw new AppServerError("invalidParams", `no commit ${against}`);
			const mergeBase = await runGit(repo.root, ["merge-base", base, "HEAD"]);
			if (mergeBase.code !== 0) throw new AppServerError("invalidParams", `no merge base with ${against}`);
			const { tree, untrackedSkipped } = await workingTree(repo);
			return {
				from: await treeOf(repo, mergeBase.stdout.toString("utf8").trim()),
				to: tree,
				untrackedSkipped,
				against,
			};
		}
	}
}

export interface NameStatus {
	/** git's status letter: A, M, D, R, T (C never: no copy detection). */
	status: string;
	path: string;
	oldPath?: string;
}

/** `git diff --name-status -z` between two trees, paired with machinePatch by the same rename detection and order. */
export async function nameStatus(repo: Repo, from: string, to: string): Promise<NameStatus[]> {
	const fields = (
		await git(repo.root, [
			"diff",
			"--name-status",
			"-z",
			"-M",
			"--no-ext-diff",
			"--no-textconv",
			"-O/dev/null",
			from,
			to,
		])
	).split("\0");
	const names: NameStatus[] = [];
	for (let i = 0; i < fields.length && fields[i] !== "";) {
		const status = fields[i][0];
		if (status === "R" || status === "C") {
			names.push({ status, oldPath: fields[i + 1], path: fields[i + 2] });
			i += 3;
		} else {
			names.push({ status, path: fields[i + 1] });
			i += 2;
		}
	}
	return names;
}

const NAMED_ESCAPES: Record<string, string> = {
	"\x07": "\\a",
	"\b": "\\b",
	"\t": "\\t",
	"\n": "\\n",
	"\v": "\\v",
	"\f": "\\f",
	"\r": "\\r",
	'"': '\\"',
	"\\": "\\\\",
};

/** git's C-style quoting under core.quotepath=false: only paths with `"`, `\` or control bytes are quoted. */
function quoted(path: string): string {
	if (!/["\\\x00-\x1f\x7f]/.test(path)) return path;
	let out = '"';
	for (const char of path) {
		const code = char.charCodeAt(0);
		out += NAMED_ESCAPES[char] ?? (code < 0x20 || code === 0x7f ? `\\${code.toString(8).padStart(3, "0")}` : char);
	}
	return `${out}"`;
}

const sectionHeader = (entry: NameStatus) =>
	`diff --git ${quoted(`a/${entry.oldPath ?? entry.path}`)} ${quoted(`b/${entry.path}`)}`;

const MARKER = Buffer.from("diff --git ");

function sectionsOf(patch: Buffer): Buffer[] {
	const starts: number[] = [];
	for (let at = 0; at < patch.length;) {
		if (patch.subarray(at, at + MARKER.length).equals(MARKER)) starts.push(at);
		const next = patch.indexOf(10, at);
		if (next === -1) break;
		at = next + 1;
	}
	return starts.map((start, i) => patch.subarray(start, starts[i + 1] ?? patch.length));
}

const headerLine = (section: Buffer) => {
	const end = section.indexOf(10);
	return section.subarray(0, end === -1 ? section.length : end).toString("utf8");
};

/**
 * Pairs each name-status entry with its sections of the patch, in order. A type change may take two sections (a
 * deletion and a creation); under `-w` a modification of whitespace only has none. Anything else that does not
 * pair is a bug, never a silent mis-pairing.
 */
export function splitPatch(names: NameStatus[], patch: Buffer, ignoreWhitespace = false): Map<NameStatus, Buffer[]> {
	const sections = sectionsOf(patch);
	const paired = new Map<NameStatus, Buffer[]>();
	let next = 0;
	for (const entry of names) {
		const expected = sectionHeader(entry);
		const taken: Buffer[] = [];
		while (next < sections.length && taken.length < (entry.status === "T" ? 2 : 1)) {
			if (headerLine(sections[next]) !== expected) break;
			taken.push(sections[next++]);
		}
		if (taken.length === 0 && !(ignoreWhitespace && entry.status === "M"))
			throw new AppServerError("internal", `the patch has no section for ${entry.path}`);
		if (taken.length > 0) paired.set(entry, taken);
	}
	if (next < sections.length)
		throw new AppServerError("internal", `an unexpected patch section: ${headerLine(sections[next])}`);
	return paired;
}

export function hunkId(path: string, extended: readonly string[], header: string, lines: readonly string[]): string {
	return createHash("sha256")
		.update(`${path}\0${extended.join("\n")}\0${header}\0${lines.join("\n")}`)
		.digest("hex")
		.slice(0, 16);
}

const STATUS: Record<string, DiffFile["status"]> = {
	A: "added",
	M: "modified",
	D: "deleted",
	R: "renamed",
	T: "typeChanged",
};
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function parseFile(entry: NameStatus, sections: Buffer[] | undefined, tooLarge: boolean): DiffFile {
	const file: DiffFile = {
		path: entry.path,
		...(entry.oldPath !== undefined ? { oldPath: entry.oldPath } : {}),
		status: STATUS[entry.status] ?? "modified",
		binary: false,
		additions: 0,
		deletions: 0,
		hunks: [],
	};
	if (tooLarge || !sections) {
		if (tooLarge) file.tooLarge = true;
		return file;
	}
	let text: string;
	try {
		text = sections.map((section) => strictUtf8.decode(section)).join("");
	} catch {
		file.binary = true;
		return file;
	}
	const extended: string[] = [];
	const hunks: DiffHunk[] = [];
	let hunk: Omit<DiffHunk, "id"> | undefined;
	let inHeader = false;
	const close = () => {
		if (hunk) hunks.push({ id: hunkId(entry.path, extended, hunk.header, hunk.lines), ...hunk });
		hunk = undefined;
	};
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			close();
			inHeader = true;
			continue;
		}
		const match = HUNK.exec(line);
		if (match) {
			close();
			inHeader = false;
			hunk = {
				header: line,
				oldStart: Number(match[1]),
				oldLines: match[2] === undefined ? 1 : Number(match[2]),
				newStart: Number(match[3]),
				newLines: match[4] === undefined ? 1 : Number(match[4]),
				lines: [],
			};
			continue;
		}
		if (inHeader) {
			if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
			else if (!line.startsWith("--- ") && !line.startsWith("+++ ")) extended.push(line);
			continue;
		}
		if (!hunk) continue;
		hunk.lines.push(line);
		if (line.startsWith("+")) file.additions++;
		else if (line.startsWith("-")) file.deletions++;
	}
	close();
	if (!file.binary) file.hunks = hunks;
	return file;
}

export interface ReadDiffOptions {
	context: number;
	ignoreWhitespace?: boolean;
	budgets?: DiffBudgets;
	signal?: AbortSignal;
}

/** Files and hunks between two trees, kept within the response budget (§6.2). */
export async function readDiff(
	repo: Repo,
	trees: Pick<ScopeTrees, "from" | "to">,
	options: ReadDiffOptions,
): Promise<{ files: DiffFile[]; filesOmitted?: number }> {
	if (!trees.from || trees.from === trees.to) return { files: [] };
	const names = await nameStatus(repo, trees.from, trees.to);
	if (names.length === 0) return { files: [] };
	let sections: Map<NameStatus, Buffer[]> | undefined;
	try {
		const patch = await machinePatch(repo, trees.from, trees.to, {
			context: options.context,
			ignoreWhitespace: options.ignoreWhitespace,
			maxStdoutBytes: PATCH_LIMIT,
			signal: options.signal,
		});
		sections = splitPatch(names, patch, options.ignoreWhitespace);
	} catch (error) {
		if (!(error instanceof OutputTooLarge)) throw error;
	}
	const budgets = options.budgets ?? { serialized: Number.POSITIVE_INFINITY, metadata: Number.POSITIVE_INFINITY };
	const files: DiffFile[] = [];
	let total = 2;
	for (let i = 0; i < names.length; i++) {
		const entry = names[i];
		const own = sections?.get(entry);
		// Under -w a whitespace-only modification has no section and is not a change.
		if (sections && !own) continue;
		const bytes = own?.reduce((sum, section) => sum + section.length, 0) ?? 0;
		const full = parseFile(entry, own, !sections || bytes > FILE_PATCH_LIMIT);
		const fullSize = Buffer.byteLength(JSON.stringify(full)) + 1;
		if (total + fullSize <= budgets.serialized) {
			files.push(full);
			total += fullSize;
			continue;
		}
		const meta: DiffFile = { ...full, tooLarge: true, hunks: [] };
		const metaSize = Buffer.byteLength(JSON.stringify(meta)) + 1;
		if (total + metaSize > budgets.metadata) return { files, filesOmitted: names.length - i };
		files.push(meta);
		total += metaSize;
	}
	return { files };
}

/** `thread/diff/read`. */
export async function readThreadDiff(
	thread: LoadedThread,
	params: ParamsOf<"thread/diff/read">,
	budgets: DiffBudgets,
): Promise<ResultOf<"thread/diff/read">> {
	const repo = await requireRepo(thread.session.sessionManager.getCwd());
	const scope = params.scope ?? "uncommitted";
	const trees = await scopeTrees(thread, repo, { scope, against: params.against, commit: params.commit });
	const { files, filesOmitted } = await readDiff(repo, trees, {
		context: params.context ?? 3,
		ignoreWhitespace: params.ignoreWhitespace,
		budgets,
	});
	return {
		scope,
		files,
		...(filesOmitted ? { filesOmitted } : {}),
		...(trees.untrackedSkipped ? { untrackedSkipped: trees.untrackedSkipped } : {}),
		...(trees.turnId !== undefined ? { turnId: trees.turnId } : {}),
		...(trees.stale ? { stale: true } : {}),
		...(trees.against !== undefined ? { against: trees.against } : {}),
	};
}
