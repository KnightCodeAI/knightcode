import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import type { ClientMethod, ParamsOf } from "@knightcode/app-server-protocol";
import { afterEach, expect, test } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { sh, shEnv, write } from "./fixtures/git-repo.ts";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { type RepoServer, repoServer, worktreeThread } from "./fixtures/worktree-server.ts";
import { cleanupServers, startServer, tempDir } from "./harness.ts";

afterEach(cleanupServers);

const seven = (changes: Record<number, string> = {}) =>
	`${[1, 2, 3, 4, 5, 6, 7].map((n) => changes[n] ?? String(n)).join("\n")}\n`;

async function local(s: RepoServer) {
	return (await s.a.client.request("thread/start", { cwd: s.cwd })).thread.id;
}
function call<M extends ClientMethod>(s: RepoServer, method: M, params: ParamsOf<M>) {
	return s.a.client.request(method, params);
}
const staged = (dir: string) => sh(dir, "diff", "--cached", "--name-only");
const log = (dir: string) => sh(dir, "log", "--format=%s");
function gate() {
	let open!: () => void;
	let entered!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	const reached = new Promise<void>((resolve) => (entered = resolve));
	return { opened, reached, open, enter: () => entered() };
}

function withOrigin(s: RepoServer) {
	const origin = join(tempDir("kc-origin-"), "o.git");
	sh(s.cwd, "init", "-q", "--bare", origin);
	sh(s.cwd, "remote", "add", "origin", origin);
	return origin;
}

/** A gh stand-in: records its arguments, prints a PR URL, or waits forever with `hang`. */
function fakeGh(mode: "record" | "hang" = "record") {
	const dir = tempDir("kc-gh-");
	const script = join(dir, "gh.cjs");
	const record = join(dir, "args.json");
	writeFileSync(
		script,
		mode === "record"
			? `require("node:fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\nconsole.log("https://github.com/o/r/pull/7");\n`
			: `require("node:fs").writeFileSync(${JSON.stringify(join(dir, "pid"))}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
	);
	return { command: [process.execPath, script], record, pidFile: join(dir, "pid") };
}

test("status counts staged, unstaged, untracked and ahead of upstream", async () => {
	const s = await repoServer({ "a.txt": "a\n", "b.txt": "b\n" });
	withOrigin(s);
	sh(s.cwd, "push", "-q", "-u", "origin", "main");
	write(s.cwd, "c.txt", "c\n");
	sh(s.cwd, "add", "c.txt");
	sh(s.cwd, "commit", "-q", "-m", "ahead");
	write(s.cwd, "a.txt", "A\n");
	sh(s.cwd, "add", "a.txt");
	write(s.cwd, "b.txt", "B\n");
	write(s.cwd, "u.txt", "u\n");
	const threadId = await local(s);
	expect(await call(s, "git/status", { threadId })).toMatchObject({
		branch: "main",
		upstream: "origin/main",
		ahead: 1,
		behind: 0,
		staged: 1,
		unstaged: 1,
		untracked: 1,
		conflicted: 0,
	});
});

test("stage and unstage one hunk", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const threadId = await local(s);
	write(s.cwd, "a.txt", seven({ 1: "ONE", 7: "SEVEN" }));
	const [file] = (await call(s, "thread/diff/read", { threadId, scope: "unstaged", context: 1 })).files;
	await call(s, "git/stage", { threadId, path: "a.txt", hunkId: file.hunks[0].id, context: 1 });
	expect(sh(s.cwd, "diff", "--cached", "-U0")).toContain("+ONE");
	expect(sh(s.cwd, "diff", "--cached", "-U0")).not.toContain("SEVEN");
	const [stagedFile] = (await call(s, "thread/diff/read", { threadId, scope: "staged", context: 1 })).files;
	await call(s, "git/unstage", { threadId, path: "a.txt", hunkId: stagedFile.hunks[0].id, context: 1 });
	expect(staged(s.cwd)).toBe("");
	expect(readFileSync(join(s.cwd, "a.txt"), "utf8")).toBe(seven({ 1: "ONE", 7: "SEVEN" }));
});

test("a hunk of an untracked file stages the file; a stale id is diffChanged", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	write(s.cwd, "new.txt", "one\n");
	const [file] = (await call(s, "thread/diff/read", { threadId, scope: "unstaged" })).files;
	write(s.cwd, "new.txt", "one\ntwo\n");
	await expect(call(s, "git/stage", { threadId, path: "new.txt", hunkId: file.hunks[0].id })).rejects.toMatchObject({
		data: { reason: "diffChanged" },
	});
	const [fresh] = (await call(s, "thread/diff/read", { threadId, scope: "unstaged" })).files;
	await call(s, "git/stage", { threadId, path: "new.txt", hunkId: fresh.hunks[0].id });
	expect(staged(s.cwd)).toBe("new.txt");
});

test("a hunk stage of a renamed file is invalidParams", async () => {
	const s = await repoServer({ "a.txt": seven() });
	const threadId = await local(s);
	sh(s.cwd, "mv", "a.txt", "b.txt");
	sh(s.cwd, "reset", "-q", "--", "a.txt", "b.txt");
	write(s.cwd, "b.txt", seven({ 1: "ONE", 7: "SEVEN" }));
	const [file] = (await call(s, "thread/diff/read", { threadId, scope: "unstaged", context: 1 })).files.filter(
		(f) => f.path === "b.txt",
	);
	expect(file.status).toBe("renamed");
	await expect(
		call(s, "git/stage", { threadId, path: "b.txt", hunkId: file.hunks[0].id, context: 1 }),
	).rejects.toMatchObject({ code: "invalidParams" });
	expect(staged(s.cwd)).toBe("");
});

test("paths are literal and new files in a new directory are their own records", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	write(s.cwd, "a[1].txt", "1");
	write(s.cwd, "a1.txt", "1");
	write(s.cwd, "new/one.txt", "1");
	write(s.cwd, "new/two.txt", "2");
	await call(s, "git/stage", { threadId, path: "a[1].txt" });
	await call(s, "git/stage", { threadId, path: "new/one.txt" });
	expect(staged(s.cwd).split("\n").sort()).toEqual(["a[1].txt", "new/one.txt"]);
	await expect(call(s, "git/stage", { threadId, path: "nope.txt" })).rejects.toMatchObject({ code: "invalidParams" });
});

test("staging then unstaging a rename by its new path leaves nothing staged", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	sh(s.cwd, "mv", "a.txt", "b.txt");
	await call(s, "git/stage", { threadId, path: "b.txt" });
	await call(s, "git/unstage", { threadId, path: "b.txt" });
	expect(staged(s.cwd)).toBe("");
});

test("commit with a message runs the commit-msg hook", async () => {
	const s = await repoServer();
	writeFileSync(join(s.cwd, ".git", "hooks", "commit-msg"), '#!/bin/sh\necho "Hooked: yes" >> "$1"\n', { mode: 0o755 });
	const threadId = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	const result = await call(s, "git/commit", { threadId, message: "edit a" });
	expect(result.commit).toBe(sh(s.cwd, "rev-parse", "HEAD"));
	expect(sh(s.cwd, "log", "-1", "--format=%B")).toContain("Hooked: yes");
	expect(result.message).toContain("Hooked: yes");
});

test("an empty or blank message is generated by the model outside the conversation", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	for (const message of [undefined, "  "]) {
		write(s.cwd, "a.txt", `edit ${message === undefined}\n`);
		s.faux.setResponses([fauxAssistantMessage([fauxText("Generated subject\n\nBody.")])]);
		const result = await call(s, "git/commit", { threadId, ...(message === undefined ? {} : { message }) });
		expect(result.message).toBe("Generated subject\n\nBody.");
		expect(sh(s.cwd, "log", "-1", "--format=%s")).toBe("Generated subject");
	}
	expect(await s.a.readTurns(threadId)).toEqual([]);
});

test("a generated message works through a session-owned virtual model", async () => {
	const s = await repoServer(undefined, {
		extraExtensions: [
			{
				name: "virt",
				factory: (knightcode: ExtensionAPI) => {
					knightcode.registerVirtualModel({
						provider: "virt",
						id: "auto",
						name: "Auto",
						route: (_request, ctx) => ({
							model: ctx.modelRegistry.find(s.faux.getModel().provider, "faux-1")!,
							thinkingLevel: "off",
						}),
					});
				},
			},
		],
	});
	const threadId = await local(s);
	await call(s, "thread/settings/update", { threadId, model: { provider: "virt", id: "auto" } });
	write(s.cwd, "a.txt", "edited\n");
	s.faux.setResponses([fauxAssistantMessage([fauxText("Virtual subject")])]);
	expect((await call(s, "git/commit", { threadId })).message).toBe("Virtual subject");
});

test("includeUnstaged commits everything by default and only the index when off; nothing is invalidParams", async () => {
	const s = await repoServer({ "a.txt": "a\n", "b.txt": "b\n" });
	const threadId = await local(s);
	write(s.cwd, "a.txt", "A\n");
	sh(s.cwd, "add", "a.txt");
	write(s.cwd, "b.txt", "B\n");
	await call(s, "git/commit", { threadId, message: "only staged", includeUnstaged: false });
	expect(sh(s.cwd, "show", "--name-only", "--format=", "HEAD")).toBe("a.txt");
	write(s.cwd, "u.txt", "u\n");
	await call(s, "git/commit", { threadId, message: "everything" });
	expect(sh(s.cwd, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["b.txt", "u.txt"]);
	await expect(call(s, "git/commit", { threadId, message: "nothing" })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("commit on an unborn branch makes the root commit, also with a generated message", async () => {
	for (const message of ["root", undefined]) {
		const s = await startServer();
		sh(s.cwd, "init", "-q", "-b", "main");
		sh(s.cwd, "config", "user.name", "Test");
		sh(s.cwd, "config", "user.email", "test@example.com");
		sh(s.cwd, "config", "commit.gpgsign", "false");
		write(s.cwd, "a.txt", "a\n");
		const a = await s.connect("desktop");
		const { thread } = await a.client.request("thread/start", { cwd: s.cwd });
		s.faux.setResponses([fauxAssistantMessage([fauxText("Root from model")])]);
		await a.client.request("git/commit", { threadId: thread.id, ...(message ? { message } : {}) });
		expect(sh(s.cwd, "log", "--format=%s")).toBe(message ?? "Root from model");
	}
});

test("commit on a detached HEAD moves no branch", async () => {
	const s = await repoServer();
	const main = sh(s.cwd, "rev-parse", "main");
	sh(s.cwd, "checkout", "-q", "--detach");
	const threadId = await local(s);
	write(s.cwd, "a.txt", "detached\n");
	const { commit } = await call(s, "git/commit", { threadId, message: "detached" });
	expect(sh(s.cwd, "rev-parse", "main")).toBe(main);
	expect(sh(s.cwd, "rev-parse", "HEAD")).toBe(commit);
});

test("a change during message generation answers concurrentChange and commits nothing", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	const parked = gate();
	s.faux.setResponses([
		async () => {
			parked.enter();
			await parked.opened;
			return fauxAssistantMessage([fauxText("late")]);
		},
	]);
	const committing = call(s, "git/commit", { threadId }).catch((e: unknown) => e);
	await parked.reached;
	write(s.cwd, "other.txt", "o\n");
	sh(s.cwd, "add", "other.txt");
	parked.open();
	expect(await committing).toMatchObject({ code: "gitConflict", data: { reason: "concurrentChange" } });
	expect(log(s.cwd)).toBe("initial");
});

test("an assume-unchanged file edited locally does not stop a commit of everything else", async () => {
	const s = await repoServer({ "a.txt": "a\n", "local.cfg": "base\n" });
	const threadId = await local(s);
	sh(s.cwd, "update-index", "--assume-unchanged", "local.cfg");
	write(s.cwd, "local.cfg", "my machine\n");
	write(s.cwd, "a.txt", "edited\n");
	expect((await call(s, "git/commit", { threadId, message: "edit a" })).message).toBe("edit a");
	expect(sh(s.cwd, "show", "--name-only", "--format=", "HEAD")).toBe("a.txt");
});

test("with includeUnstaged, a working file edited while the message is written answers concurrentChange", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	const parked = gate();
	s.faux.setResponses([
		async () => {
			parked.enter();
			await parked.opened;
			return fauxAssistantMessage([fauxText("late")]);
		},
	]);
	const committing = call(s, "git/commit", { threadId }).catch((e: unknown) => e);
	await parked.reached;
	write(s.cwd, "a.txt", "edited again\n");
	parked.open();
	expect(await committing).toMatchObject({ code: "gitConflict", data: { reason: "concurrentChange" } });
	expect(log(s.cwd)).toBe("initial");
	// Nothing was staged before: the refusal puts that back.
	expect(staged(s.cwd)).toBe("");
});

test("a failed commit message request puts back what the user had staged", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	write(s.cwd, "a.txt", "staged\n");
	sh(s.cwd, "add", "a.txt");
	write(s.cwd, "b.txt", "unstaged\n");
	s.faux.setResponses([fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "model down" })]);
	await expect(call(s, "git/commit", { threadId })).rejects.toBeInstanceOf(Error);
	expect(staged(s.cwd)).toBe("a.txt");
	expect(log(s.cwd)).toBe("initial");
});

test("the repository lock is free while the message is written: a stage goes through and the commit sees it", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	write(s.cwd, "a.txt", "edited\n");
	const parked = gate();
	s.faux.setResponses([
		async () => {
			parked.enter();
			await parked.opened;
			return fauxAssistantMessage([fauxText("late")]);
		},
	]);
	const committing = call(s, "git/commit", { threadId }).catch((e: unknown) => e);
	await parked.reached;
	write(s.cwd, "other.txt", "o\n");
	try {
		// Queued behind the commit's lock, this stage would wait for the model and the test would time out.
		await call(s, "git/stage", { threadId, path: "other.txt" });
	} finally {
		parked.open();
	}
	expect(await committing).toMatchObject({ code: "gitConflict", data: { reason: "concurrentChange" } });
	expect(log(s.cwd)).toBe("initial");
});

test("a branch switch while a turn runs in the checkout is turnInProgress", async () => {
	const held = createHeldTurn();
	const s = await repoServer(undefined, { extraExtensions: [{ name: "held", factory: held.extension }] });
	sh(s.cwd, "branch", "other");
	const threadId = await local(s);
	const busy = (await call(s, "thread/start", { cwd: s.cwd, approvalMode: "fullAccess" })).thread.id;
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await call(s, "turn/start", { threadId: busy, text: "hold" });
	await held.entered;
	try {
		await expect(call(s, "git/branch/switch", { threadId, name: "other" })).rejects.toMatchObject({
			code: "turnInProgress",
		});
		// Index changes too: a tool may be halfway through a file.
		write(s.cwd, "a.txt", "edited\n");
		await expect(call(s, "git/stage", { threadId, path: "a.txt" })).rejects.toMatchObject({ code: "turnInProgress" });
		await expect(call(s, "git/commit", { threadId, message: "x" })).rejects.toMatchObject({ code: "turnInProgress" });
	} finally {
		held.release();
	}
	expect(sh(s.cwd, "branch", "--show-current")).toBe("main");
});

test("during a merge, unstage all keeps the merge, and the commit is a merge commit", async () => {
	const s = await repoServer({ "a.txt": "a\n" });
	sh(s.cwd, "checkout", "-q", "-b", "side");
	write(s.cwd, "side.txt", "side\n");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "side");
	sh(s.cwd, "checkout", "-q", "main");
	write(s.cwd, "main.txt", "main\n");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "main");
	sh(s.cwd, "merge", "-q", "--no-commit", "--no-ff", "side");
	const mergeHead = readFileSync(join(s.cwd, ".git", "MERGE_HEAD"), "utf8");
	const origHead = readFileSync(join(s.cwd, ".git", "ORIG_HEAD"), "utf8");
	const threadId = await local(s);
	await call(s, "git/unstage", { threadId });
	expect(readFileSync(join(s.cwd, ".git", "MERGE_HEAD"), "utf8")).toBe(mergeHead);
	expect(readFileSync(join(s.cwd, ".git", "ORIG_HEAD"), "utf8")).toBe(origHead);
	expect(readFileSync(join(s.cwd, "side.txt"), "utf8")).toBe("side\n");
	expect((await call(s, "git/status", { threadId })).operation).toBe("merge");
	await call(s, "git/commit", { threadId, message: "merge side" });
	expect(sh(s.cwd, "rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);
});

test("unstage all on an unborn branch unstages everything", async () => {
	const s = await startServer();
	sh(s.cwd, "init", "-q", "-b", "main");
	write(s.cwd, "a.txt", "a\n");
	write(s.cwd, "b.txt", "b\n");
	sh(s.cwd, "add", "-A");
	const a = await s.connect("desktop");
	const { thread } = await a.client.request("thread/start", { cwd: s.cwd });
	await a.client.request("git/unstage", { threadId: thread.id });
	expect(sh(s.cwd, "status", "--porcelain")).toBe("?? a.txt\n?? b.txt");
});

test("branch create on a detached worktree keeps the edit; an existing name is branchExists", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	write(thread.cwd, "a.txt", "worktree edit\n");
	expect(await call(s, "git/branch/create", { threadId: thread.id, name: "kc/feature" })).toEqual({
		branch: "kc/feature",
	});
	expect(sh(thread.cwd, "symbolic-ref", "--short", "HEAD")).toBe("kc/feature");
	expect(readFileSync(join(thread.cwd, "a.txt"), "utf8")).toBe("worktree edit\n");
	await expect(call(s, "git/branch/create", { threadId: thread.id, name: "main" })).rejects.toMatchObject({
		data: { reason: "branchExists" },
	});
	await expect(call(s, "git/branch/create", { threadId: thread.id, name: "bad..name" })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("branch switch refuses to overwrite an ignored file the branch tracks", async () => {
	const s = await repoServer({ ".gitignore": ".env\n", "a.txt": "a\n" });
	sh(s.cwd, "checkout", "-q", "-b", "other");
	write(s.cwd, ".env", "tracked on other\n");
	sh(s.cwd, "add", "-f", ".env");
	sh(s.cwd, "commit", "-q", "-m", "other");
	sh(s.cwd, "checkout", "-q", "main");
	write(s.cwd, ".env", "local secret\n");
	const threadId = await local(s);
	await expect(call(s, "git/branch/switch", { threadId, name: "other" })).rejects.toMatchObject({
		data: { reason: "localChanges", paths: [".env"] },
	});
	expect(readFileSync(join(s.cwd, ".env"), "utf8")).toBe("local secret\n");
	expect(sh(s.cwd, "symbolic-ref", "--short", "HEAD")).toBe("main");
});

test("branch switch refuses to overwrite a local edit, then switches when clean", async () => {
	const s = await repoServer({ "a.txt": "a\n" });
	sh(s.cwd, "checkout", "-q", "-b", "other");
	write(s.cwd, "a.txt", "other\n");
	sh(s.cwd, "commit", "-q", "-am", "other");
	sh(s.cwd, "checkout", "-q", "main");
	write(s.cwd, "a.txt", "local edit\n");
	const threadId = await local(s);
	await expect(call(s, "git/branch/switch", { threadId, name: "other" })).rejects.toMatchObject({
		data: { reason: "localChanges" },
	});
	expect(readFileSync(join(s.cwd, "a.txt"), "utf8")).toBe("local edit\n");
	sh(s.cwd, "checkout", "-q", "--", "a.txt");
	expect(await call(s, "git/branch/switch", { threadId, name: "other" })).toEqual({ branch: "other" });
	await expect(call(s, "git/branch/switch", { threadId, name: "nope" })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("branches lists newest first with the current one", async () => {
	const s = await repoServer();
	sh(s.cwd, "checkout", "-q", "-b", "newer");
	write(s.cwd, "n.txt", "n");
	sh(s.cwd, "add", "-A");
	shEnv(s.cwd, { GIT_COMMITTER_DATE: "2030-01-01T00:00:00" }, "commit", "-q", "-m", "newer");
	const threadId = await local(s);
	const result = await call(s, "git/branches", { threadId });
	expect(result.current).toBe("newer");
	expect(result.branches[0]).toBe("newer");
	expect(result.branches).toContain("main");
});

test("branches are listed for a project cwd before any thread exists", async () => {
	const s = await repoServer();
	sh(s.cwd, "branch", "feature");
	const result = await s.a.client.request("git/branches", { cwd: s.cwd });
	expect(result.current).toBe("main");
	expect(result.branches.sort()).toEqual(["feature", "main"]);
});

test("log in a worktree lists only the thread's commits since its base", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	for (const name of ["one", "two"]) {
		write(thread.cwd, `${name}.txt`, name);
		sh(thread.cwd, "add", "-A");
		sh(thread.cwd, "commit", "-q", "-m", name);
	}
	const result = await call(s, "git/log", { threadId: thread.id });
	expect(result.commits.map((c) => c.subject)).toEqual(["two", "one"]);
	expect(result.base).toBe(thread.workspace.mode === "worktree" ? thread.workspace.baseRef : "");
});

test("push sets the upstream once, then pushes plainly; a non-fast-forward is pushRejected", async () => {
	const s = await repoServer();
	const origin = withOrigin(s);
	const threadId = await local(s);
	expect(await call(s, "git/push", { threadId })).toEqual({ remote: "origin", branch: "main", setUpstream: true });
	write(s.cwd, "a.txt", "two\n");
	sh(s.cwd, "commit", "-q", "-am", "two");
	expect(await call(s, "git/push", { threadId })).toEqual({ remote: "origin", branch: "main", setUpstream: false });
	expect(sh(origin, "rev-parse", "main")).toBe(sh(s.cwd, "rev-parse", "HEAD"));
	sh(s.cwd, "reset", "-q", "--hard", "HEAD~1");
	write(s.cwd, "a.txt", "diverged\n");
	sh(s.cwd, "commit", "-q", "-am", "diverged");
	await expect(call(s, "git/push", { threadId })).rejects.toMatchObject({ data: { reason: "pushRejected" } });
	// A branch tracking another name never pushes onto it (push.default=simple's rule).
	sh(s.cwd, "switch", "-q", "-c", "feature", "--track", "origin/main");
	write(s.cwd, "f.txt", "feature\n");
	sh(s.cwd, "add", "f.txt");
	sh(s.cwd, "commit", "-q", "-m", "feature");
	await expect(call(s, "git/push", { threadId })).rejects.toMatchObject({ code: "invalidParams" });
	expect(sh(origin, "rev-parse", "main")).not.toBe(sh(s.cwd, "rev-parse", "HEAD"));
});

test("a configured force refspec and push.default=matching push only the thread's branch", async () => {
	const s = await repoServer();
	const origin = withOrigin(s);
	sh(s.cwd, "push", "-q", "origin", "main", "main:other");
	sh(s.cwd, "config", "remote.origin.push", "+refs/heads/*:refs/heads/*");
	sh(s.cwd, "config", "push.default", "matching");
	sh(s.cwd, "branch", "-q", "--set-upstream-to=origin/main", "main");
	sh(s.cwd, "branch", "-q", "other");
	sh(s.cwd, "checkout", "-q", "other");
	write(s.cwd, "o.txt", "o");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "other ahead");
	sh(s.cwd, "checkout", "-q", "main");
	write(s.cwd, "m.txt", "m");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "main ahead");
	const originOther = sh(origin, "rev-parse", "other");
	const threadId = await local(s);
	await call(s, "git/push", { threadId });
	expect(sh(origin, "rev-parse", "main")).toBe(sh(s.cwd, "rev-parse", "main"));
	expect(sh(origin, "rev-parse", "other")).toBe(originOther);
});

test("pull requests pass exactly what was given to gh", async () => {
	const gh = fakeGh();
	const s = await repoServer(undefined, { ghCommand: gh.command });
	sh(s.cwd, "checkout", "-q", "-b", "feature");
	write(s.cwd, "f.txt", "f");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "Feature subject");
	const threadId = await local(s);
	const args = async (params: object) => {
		expect(await call(s, "git/pr/create", { threadId, ...params })).toEqual({ url: "https://github.com/o/r/pull/7" });
		return JSON.parse(readFileSync(gh.record, "utf8"));
	};
	const head = ["pr", "create", "--head", "feature"];
	for (const draft of [false, true]) {
		const tail = draft ? ["--draft"] : [];
		const extra = draft ? { draft } : {};
		expect(await args({ ...extra })).toEqual([...head, "--fill", ...tail]);
		expect(await args({ body: "B", ...extra })).toEqual([
			...head,
			"--title",
			"Feature subject",
			"--body",
			"B",
			...tail,
		]);
		expect(await args({ title: "T", ...extra })).toEqual([...head, "--title", "T", "--body", "", ...tail]);
		expect(await args({ title: "T", body: "B", ...extra })).toEqual([...head, "--title", "T", "--body", "B", ...tail]);
	}
});

test("gh that is not installed answers toolMissing", async () => {
	const s = await repoServer(undefined, { ghCommand: [join(tmpdir(), "kc-no-gh-here")] });
	const threadId = await local(s);
	await expect(call(s, "git/pr/create", { threadId })).rejects.toMatchObject({ code: "toolMissing" });
});

test("shutdown while gh hangs ends the request and leaves no process", async () => {
	const gh = fakeGh("hang");
	const s = await repoServer(undefined, { ghCommand: gh.command });
	const threadId = await local(s);
	const creating = call(s, "git/pr/create", { threadId }).catch((e: unknown) => e);
	await expect.poll(() => existsSync(gh.pidFile), { timeout: 15_000 }).toBe(true);
	const pid = Number(readFileSync(gh.pidFile, "utf8"));
	try {
		await s.threads.closeAll();
		expect(await creating).toBeInstanceOf(Error);
		if (process.platform !== "win32") expect(() => process.kill(pid, 0)).toThrow();
	} finally {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
}, 40_000);

test("shutdown while a post-checkout hook hangs ends a branch create", async () => {
	const s = await repoServer();
	const threadId = await local(s);
	const hooks = tempDir("kc-hooks-");
	const marker = join(hooks, "entered").replace(/\\/g, "/");
	writeFileSync(join(hooks, "post-checkout"), `#!/bin/sh\necho entered > "${marker}"\nsleep 600\n`, { mode: 0o755 });
	sh(s.cwd, "config", "core.hooksPath", hooks.replace(/\\/g, "/"));
	const creating = call(s, "git/branch/create", { threadId, name: "feature" }).catch((e: unknown) => e);
	await expect.poll(() => existsSync(marker), { timeout: 15_000 }).toBe(true);
	await s.threads.closeAll();
	expect(await creating).toBeInstanceOf(Error);
}, 40_000);

test("shutdown during a commit message request that never answers ends it, also through an ignoring router", async () => {
	for (const virtual of [false, true]) {
		const parked = gate();
		const s = await repoServer(undefined, {
			extraExtensions: virtual
				? [
						{
							name: "stuck",
							factory: (knightcode: ExtensionAPI) => {
								knightcode.registerVirtualModel({
									provider: "stuck",
									id: "router",
									name: "Stuck",
									route: () => {
										parked.enter();
										return new Promise<never>(() => {});
									},
								});
							},
						},
					]
				: [],
		});
		const threadId = await local(s);
		if (virtual) await call(s, "thread/settings/update", { threadId, model: { provider: "stuck", id: "router" } });
		write(s.cwd, "a.txt", "edited\n");
		s.faux.setResponses([
			async () => {
				parked.enter();
				return new Promise(() => {});
			},
		]);
		const committing = call(s, "git/commit", { threadId }).catch((e: unknown) => e);
		await parked.reached;
		await s.threads.closeAll();
		expect(await committing).toBeInstanceOf(Error);
		expect(log(s.cwd)).toBe("initial");
	}
}, 40_000);
