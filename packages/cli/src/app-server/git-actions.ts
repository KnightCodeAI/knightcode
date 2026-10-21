/**
 * The git actions a review pane needs (§6.3), on the thread's own checkout: status, stage, unstage, commit (with a
 * generated message), push, pull request, branches and log. Every child process gets the manager's shutdown signal.
 */

import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { ParamsOf, ResultOf } from "@knightcode/app-server-protocol";
import type { ModelRuntime } from "../core/model-runtime.ts";
import { defaultBranch, findHunk, hunkPatch, nameStatus, scopeTrees } from "./diff.ts";
import { AppServerError } from "./errors.ts";
import {
	git,
	headTree,
	indexTree,
	machineApply,
	machinePatch,
	operationIn,
	pathsInTheWay,
	type Repo,
	runGit,
	runProcess,
	discardSavedIndex,
	restoreIndex,
	saveIndex,
	stagedAllTree,
	withRepoLock,
} from "./git.ts";
import type { LoadedThread } from "./loaded-thread.ts";
import { validBranchName } from "./workspaces.ts";

export interface GitActionContext {
	signal: AbortSignal;
	models: ModelRuntime;
	/** The gh command and any leading arguments; tests point it at a stand-in. */
	ghCommand?: string[];
}

const invalid = (message: string) => new AppServerError("invalidParams", message);
const conflict = (reason: string, message: string, data: object = {}) =>
	new AppServerError("gitConflict", message, { reason, ...data });

const COMMIT_PROMPT =
	"Write a git commit message for this diff: a subject line under 72 characters, a blank line, then a short body only if the change needs explaining. Reply with the message only.";
const COMMIT_DIFF_BYTES = 48 * 1024;

const trimmed = (result: { stdout: Buffer }) => result.stdout.toString("utf8").trim();

async function optional(repo: Repo, args: string[]): Promise<string | null> {
	const result = await runGit(repo, args);
	return result.code === 0 ? trimmed(result) : null;
}

const currentBranch = (repo: Repo) => optional(repo, ["symbolic-ref", "-q", "--short", "HEAD"]);

interface StatusRecord {
	kind: "1" | "2" | "u" | "?";
	xy: string;
	submodule: boolean;
	path: string;
	origPath?: string;
}

async function statusRecords(repo: Repo, untracked: "normal" | "all") {
	const fields = (
		await git(repo, ["status", "--porcelain=v2", "--branch", "-z", `--untracked-files=${untracked}`])
	).split("\0");
	const records: StatusRecord[] = [];
	const branch: Record<string, string> = {};
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		if (field.startsWith("# ")) {
			const [key, ...value] = field.slice(2).split(" ");
			branch[key] = value.join(" ");
		} else if (field.startsWith("1 ") || field.startsWith("u ")) {
			const parts = field.split(" ");
			const fixed = field.startsWith("1 ") ? 8 : 10;
			records.push({
				kind: field[0] as "1" | "u",
				xy: parts[1],
				submodule: parts[2].startsWith("S"),
				path: parts.slice(fixed).join(" "),
			});
		} else if (field.startsWith("2 ")) {
			const parts = field.split(" ");
			records.push({
				kind: "2",
				xy: parts[1],
				submodule: parts[2].startsWith("S"),
				path: parts.slice(9).join(" "),
				origPath: fields[++i],
			});
		} else if (field.startsWith("? ")) records.push({ kind: "?", xy: "??", submodule: false, path: field.slice(2) });
	}
	return { records, branch };
}

export async function gitStatus(repo: Repo): Promise<ResultOf<"git/status">> {
	// Per file: "normal" reports a new directory as one untracked record however many files it holds.
	const { records, branch } = await statusRecords(repo, "all");
	const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
	for (const record of records) {
		if (record.kind === "?") counts.untracked++;
		else if (record.kind === "u") counts.conflicted++;
		else {
			if (record.xy[0] !== ".") counts.staged++;
			if (record.xy[1] !== ".") counts.unstaged++;
		}
	}
	const ab = /^\+(\d+) -(\d+)$/.exec(branch["branch.ab"] ?? "");
	const head = branch["branch.head"];
	const oid = branch["branch.oid"];
	const operation = operationIn(repo);
	return {
		...(head && head !== "(detached)" ? { branch: head } : {}),
		...(oid && oid !== "(initial)" ? { head: oid } : {}),
		...(branch["branch.upstream"] ? { upstream: branch["branch.upstream"] } : {}),
		ahead: ab ? Number(ab[1]) : 0,
		behind: ab ? Number(ab[2]) : 0,
		...counts,
		...(operation ? { operation } : {}),
	};
}

/** The paths a stage or unstage by path acts on: a rename or copy record is one change of both its paths. */
async function recordPaths(repo: Repo, path: string): Promise<string[]> {
	const { records } = await statusRecords(repo, "all");
	const record = records.find((r) => r.path === path || r.origPath === path);
	if (!record) throw invalid(`${path} has no changes`);
	if (record.submodule) throw invalid("submodule changes are not supported here; commit them in the submodule");
	return record.origPath ? [record.origPath, record.path] : [record.path];
}

export async function gitStage(
	thread: LoadedThread,
	repo: Repo,
	params: ParamsOf<"git/stage">,
): Promise<ResultOf<"git/stage">> {
	if (params.hunkId !== undefined && params.path === undefined) throw invalid("a hunk needs its path");
	if (params.path === undefined) {
		await git(repo, ["add", "-A"]);
		return { paths: [] };
	}
	if (params.hunkId === undefined) {
		const paths = await recordPaths(repo, params.path);
		// A staged rename's old name is in neither the index nor the working tree; naming it would fail the add.
		const known = new Set((await git(repo, ["ls-files", "-z", "--", ...paths])).split("\0"));
		const present = paths.filter((p) => known.has(p) || lstatSync(join(repo.root, p), { throwIfNoEntry: false }));
		if (present.length > 0) await git(repo, ["add", "-A", "--", ...present]);
		return { paths };
	}
	const trees = await scopeTrees(thread, repo, { scope: "unstaged" });
	const entry = (await nameStatus(repo, trees.from, trees.to)).find((e) => e.path === params.path);
	if (!entry) throw invalid(`${params.path} has no unstaged changes`);
	const context = params.context ?? 3;
	if (entry.status === "A") {
		// git cannot stage part of a file the index does not know: the hunk stages the whole file.
		const { hunk } = await findHunk(repo, trees, entry, params.hunkId, context);
		if (!hunk) throw conflict("diffChanged", `${entry.path} changed since it was read`, { paths: [entry.path] });
		await git(repo, ["add", "-A", "--", entry.path]);
		return { paths: [entry.path] };
	}
	const patch = await hunkPatch(repo, trees, entry, params.hunkId, context);
	await applyChecked(repo, patch, { cached: true }, [entry.path]);
	return { paths: [entry.path] };
}

export async function gitUnstage(
	thread: LoadedThread,
	repo: Repo,
	params: ParamsOf<"git/unstage">,
): Promise<ResultOf<"git/unstage">> {
	if (params.hunkId !== undefined && params.path === undefined) throw invalid("a hunk needs its path");
	if (params.path === undefined) {
		// Path-limited: a pathless reset is a mixed reset that deletes MERGE_HEAD and rewrites ORIG_HEAD.
		await git(repo, ["reset", "-q", "--", "."]);
		return { paths: [] };
	}
	if (params.hunkId === undefined) {
		const paths = await recordPaths(repo, params.path);
		await git(repo, ["reset", "-q", "--", ...paths]);
		return { paths };
	}
	const trees = await scopeTrees(thread, repo, { scope: "staged" });
	const entry = (await nameStatus(repo, trees.from, trees.to)).find((e) => e.path === params.path);
	if (!entry) throw invalid(`${params.path} has no staged changes`);
	const patch = await hunkPatch(repo, trees, entry, params.hunkId, params.context ?? 3);
	await applyChecked(repo, patch, { cached: true, reverse: true }, [entry.path]);
	return { paths: [entry.path] };
}

async function applyChecked(repo: Repo, patch: Buffer, mode: { cached: boolean; reverse?: boolean }, paths: string[]) {
	const check = await machineApply(repo, patch, { ...mode, check: true });
	if (check.code !== 0) throw conflict("patchFailed", "the change no longer applies", { paths, output: check.stderr });
	const applied = await machineApply(repo, patch, mode);
	if (applied.code !== 0)
		throw conflict("patchFailed", "the change no longer applies", { paths, output: applied.stderr });
}

/** The commit message the thread's model writes for the staged diff, outside the conversation. */
async function generateMessage(thread: LoadedThread, repo: Repo, from: string, to: string, ctx: GitActionContext) {
	const model = thread.session.model;
	if (!model) throw new AppServerError("authRequired", "no model selected to write the commit message");
	let diff = (await machinePatch(repo, from, to, { signal: ctx.signal })).toString("utf8");
	if (Buffer.byteLength(diff) > COMMIT_DIFF_BYTES)
		diff = `${Buffer.from(diff).subarray(0, COMMIT_DIFF_BYTES).toString("utf8")}\n[… the diff was cut at 48 KiB]`;
	const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(120_000)]);
	const request = ctx.models.completeSimple(
		model,
		{
			systemPrompt: COMMIT_PROMPT,
			messages: [{ role: "user", content: [{ type: "text", text: diff }], timestamp: Date.now() }],
		},
		{ maxTokens: 1024, signal },
		thread.session.resourceLoader.getExtensions().runtime,
	);
	request.catch(() => {});
	// A session-owned router may ignore the signal, so the call is raced against it here.
	const cancelled = new Promise<never>((_resolve, reject) => {
		const fail = () => reject(new AppServerError("internal", "the commit message request was cancelled"));
		if (signal.aborted) fail();
		else signal.addEventListener("abort", fail, { once: true });
	});
	const reply = await Promise.race([request, cancelled]);
	if (signal.aborted) throw new AppServerError("internal", "the commit message request was cancelled");
	if (reply.stopReason === "error" || reply.stopReason === "aborted")
		throw new AppServerError("internal", reply.errorMessage ?? "the model did not write a commit message");
	const text = reply.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("")
		.trim();
	if (!text) throw new AppServerError("internal", "the model wrote an empty commit message");
	return text;
}

export async function gitCommit(
	thread: LoadedThread,
	repo: Repo,
	params: ParamsOf<"git/commit">,
	ctx: GitActionContext,
	/** Runs the staging step; the caller holds the checkout for it (no turn starts while `git add` reads the files). */
	staging: <T>(step: () => Promise<T>) => Promise<T> = (step) => withRepoLock(repo, step),
): Promise<ResultOf<"git/commit">> {
	const capture = async () => ({
		head: await optional(repo, ["rev-parse", "-q", "--verify", "HEAD"]),
		ref: await optional(repo, ["symbolic-ref", "-q", "HEAD"]),
		index: await indexTree(repo, ctx.signal),
	});
	// The repository lock is held for the git steps only, never across the model call writing the message.
	const { before, base, original, saved } = await staging(async () => {
		// What the user had staged, put back exactly (flags and all) if no commit comes of this.
		const original = params.includeUnstaged !== false ? await indexTree(repo, ctx.signal) : undefined;
		const saved = original ? await saveIndex(repo, ctx.signal) : undefined;
		if (original) await git(repo, ["add", "-A"], { signal: ctx.signal });
		return { before: await capture(), base: await headTree(repo), original, saved };
	});
	try {
		// Only an index still as this commit left it goes back: anything staged since is the user's.
		// `hookOwned`: a refused commit whose hooks may have rewritten the index; with the checkout and repository lock
		// held nothing else changed it, so the saved index comes back whatever it now holds.
		const putBack = async (hookOwned = false) => {
			if (!original || original === before.index) return;
			if (!hookOwned && (await indexTree(repo, ctx.signal)) !== before.index) return;
			if (saved) await restoreIndex(repo, saved, ctx.signal);
			else await git(repo, ["read-tree", original]);
		};
		// The repository lock only, not the checkout: a turn that started meanwhile must not stop the user's index
		// coming back, and touches no file of it.
		const restore = () => withRepoLock(repo, putBack);
		if (before.index === base) {
			await restore();
			throw invalid("nothing to commit");
		}
		let message: string;
		try {
			message = params.message?.trim() ? params.message : await generateMessage(thread, repo, base, before.index, ctx);
		} catch (error) {
			await restore().catch(() => {});
			throw error;
		}
		// The commit runs the user's hooks, which can rewrite the index and working tree (lint-staged): it holds the
		// checkout as staging did. A turn that started while the message was written refuses that hold before the step
		// runs: the user's staging then goes back too.
		let entered = false;
		try {
			return await staging(async () => {
				entered = true;
				const now = await capture();
				// With includeUnstaged, the working tree too: an edit made while the message was written would otherwise
				// be left out of a commit that was asked to take everything (staged into a temporary index).
				const changed =
					now.head !== before.head ||
					now.ref !== before.ref ||
					now.index !== before.index ||
					(original !== undefined && (await stagedAllTree(repo, ctx.signal)) !== before.index);
				if (changed) {
					// No commit comes of this: what the user had staged goes back (the checkout is already held here).
					await putBack();
					throw conflict("concurrentChange", "the checkout changed while the commit message was written");
				}
				const result = await runGit(repo, ["commit", "-q", "-F", "-"], {
					input: message,
					// Hooks run here and glob their own pathspecs (git diff --cached -- '*.py'): not literal for them.
					env: { GIT_LITERAL_PATHSPECS: "0" },
					signal: ctx.signal,
					// The user's hooks and signing run here: a pre-commit test suite can take minutes, as push's bound allows.
					timeoutMs: 300_000,
				});
				if (result.code !== 0) {
					// A hook or signing refused it: no commit, so the user's staging goes back.
					await putBack(true);
					throw new AppServerError("internal", `git commit failed: ${result.stderr.trim()}`, {
						output: result.stderr,
					});
				}
				// A commit-msg hook may have rewritten the message: answer with what was committed.
				const commit = await git(repo, ["rev-parse", "HEAD"]);
				return { commit, message: (await git(repo, ["log", "-1", "--format=%B", commit])).trimEnd() };
			});
		} catch (error) {
			if (!entered) await restore().catch(() => {});
			throw error;
		}
	} finally {
		await discardSavedIndex(saved);
	}
}

export async function gitPush(repo: Repo, ctx: GitActionContext): Promise<ResultOf<"git/push">> {
	const branch = await currentBranch(repo);
	if (!branch) throw invalid("HEAD is detached: create a branch first");
	const upstreamRemote = await optional(repo, ["config", "--get", `branch.${branch}.remote`]);
	const upstreamMerge = await optional(repo, ["config", "--get", `branch.${branch}.merge`]);
	let remote: string;
	let destination: string;
	let setUpstream: boolean;
	if (upstreamRemote && upstreamMerge && upstreamRemote !== ".") {
		// As push.default=simple: a branch tracking another name (feature on origin/main) never pushes onto it.
		if (upstreamMerge !== `refs/heads/${branch}`)
			throw invalid(`${branch} tracks ${upstreamMerge.replace(/^refs\/heads\//, "")}; push it from a terminal`);
		remote = upstreamRemote;
		destination = upstreamMerge;
		setUpstream = false;
	} else {
		const remotes = (await git(repo, ["remote"])).split("\n").filter(Boolean);
		const chosen = remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : undefined;
		if (!chosen) throw invalid("no remote to push to");
		remote = chosen;
		destination = `refs/heads/${branch}`;
		setUpstream = true;
	}
	// One explicit non-forcing refspec: a configured `+` push refspec or push.default=matching never applies.
	const args = [
		"push",
		"--no-follow-tags",
		"--recurse-submodules=no",
		...(setUpstream ? ["--set-upstream"] : []),
		remote,
		`refs/heads/${branch}:${destination}`,
	];
	// pre-push hooks run here: their pathspecs are not literal.
	const result = await runGit(repo, args, {
		timeoutMs: 300_000,
		signal: ctx.signal,
		env: { GIT_LITERAL_PATHSPECS: "0" },
	});
	if (result.code !== 0) {
		if (result.stderr.includes("[rejected]"))
			throw conflict("pushRejected", "the remote rejected the push; pull first", { output: result.stderr });
		throw new AppServerError("internal", `git push failed: ${result.stderr.trim()}`, { output: result.stderr });
	}
	return { remote, branch, setUpstream };
}

export async function gitBranches(repo: Repo): Promise<ResultOf<"git/branches">> {
	const branches = (
		await git(repo, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"])
	)
		.split("\n")
		.filter(Boolean);
	const current = await currentBranch(repo);
	const fallback = await defaultBranch(repo);
	return {
		...(current ? { current } : {}),
		...(fallback ? { defaultBranch: fallback } : {}),
		branches,
	};
}

export async function gitBranchCreate(repo: Repo, name: string): Promise<ResultOf<"git/branch/create">> {
	if (!validBranchName(name) || (await runGit(repo, ["check-ref-format", "--branch", name])).code !== 0)
		throw invalid(`not a valid branch name: ${name}`);
	if ((await runGit(repo, ["rev-parse", "-q", "--verify", `refs/heads/${name}`])).code === 0)
		throw conflict("branchExists", `a branch named ${name} exists`);
	await git(repo, ["switch", "-q", "-c", name]);
	return { branch: name };
}

export async function gitBranchSwitch(repo: Repo, name: string): Promise<ResultOf<"git/branch/switch">> {
	const { branches } = await gitBranches(repo);
	if (!branches.includes(name)) throw invalid(`no local branch ${name}`);
	const written = (await git(repo, ["diff", "--name-only", "--no-renames", "-z", "HEAD", `refs/heads/${name}`]))
		.split("\0")
		.filter(Boolean);
	const blocked = await pathsInTheWay(repo, written);
	if (blocked.length > 0)
		throw conflict("localChanges", "Stash or commit your local changes to switch branches.", { paths: blocked });
	const result = await runGit(repo, ["switch", "-q", name]);
	if (result.code !== 0)
		throw conflict("localChanges", "Stash or commit your local changes to switch branches.", {
			output: result.stderr,
		});
	return { branch: name };
}

export async function gitLog(thread: LoadedThread, repo: Repo, limit: number): Promise<ResultOf<"git/log">> {
	if (!(await optional(repo, ["rev-parse", "-q", "--verify", "HEAD"]))) return { commits: [] };
	const workspace = thread.workspace;
	let base: string | undefined = workspace.mode === "worktree" ? workspace.baseRef : undefined;
	if (!base) {
		const fallback = await defaultBranch(repo);
		if (fallback) base = (await optional(repo, ["merge-base", fallback, "HEAD"])) ?? undefined;
	}
	const fields = (
		await git(repo, [
			"log",
			"-z",
			"--format=%H%x00%s%x00%an%x00%ct",
			"-n",
			String(limit),
			base ? `${base}..HEAD` : "HEAD",
		])
	).split("\0");
	const commits: ResultOf<"git/log">["commits"] = [];
	for (let i = 0; i + 3 < fields.length; i += 4)
		commits.push({ sha: fields[i], subject: fields[i + 1], author: fields[i + 2], time: Number(fields[i + 3]) });
	return { ...(base ? { base } : {}), commits };
}

export async function gitPullRequest(
	repo: Repo,
	params: ParamsOf<"git/pr/create">,
	ctx: GitActionContext,
): Promise<ResultOf<"git/pr/create">> {
	const branch = await currentBranch(repo);
	if (!branch) throw invalid("HEAD is detached: create a branch first");
	const args = ["pr", "create", "--head", branch];
	if (params.title === undefined && params.body === undefined) args.push("--fill");
	else
		args.push("--title", params.title ?? (await git(repo, ["log", "-1", "--format=%s"])), "--body", params.body ?? "");
	if (params.draft) args.push("--draft");
	const [command, ...leading] = ctx.ghCommand ?? ["gh"];
	const result = await runProcess(command, [...leading, ...args], {
		cwd: repo.root,
		env: { GIT_LITERAL_PATHSPECS: "0" },
		timeoutMs: 120_000,
		signal: ctx.signal,
	});
	const url = result.stdout
		.toString("utf8")
		.split(/\r?\n/)
		.filter((line) => line.startsWith("https://"))
		.at(-1);
	if (result.code !== 0 || !url)
		throw new AppServerError("internal", `gh pr create failed: ${result.stderr.trim().slice(-2000)}`);
	return { url };
}
