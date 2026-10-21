import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import { workspaceHooks } from "../../src/app-server/workspaces.ts";
import { checkoutState, sh, write } from "./fixtures/git-repo.ts";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { type RepoServer, repoServer, say, worktreeThread } from "./fixtures/worktree-server.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

const POSIX = process.platform !== "win32";
const status = (dir: string) => sh(dir, "status", "--porcelain");

const handoff = (s: RepoServer, threadId: string, to: "local" | "worktree", extra: object = {}) =>
	s.a.client.request("thread/handoff", { threadId, to, ...extra });

/** A worktree thread that has sent a message, so it has a session file to move. */
async function started(s: RepoServer, request: object = {}, cwd = s.cwd) {
	const { thread } = await worktreeThread(s, request, cwd);
	await say(s, thread.id);
	if (thread.workspace.mode !== "worktree") throw new Error("unreachable");
	return { thread, path: thread.workspace.path };
}

function commitIn(dir: string, path: string, text: string, message = path) {
	write(dir, path, text);
	sh(dir, "add", "-A");
	sh(dir, "commit", "-q", "-m", message);
}

test("to local: the branch, commits and uncommitted changes move; the worktree stays, clean and detached", async () => {
	const s = await repoServer();
	const { thread, path } = await started(s);
	commitIn(path, "c.txt", "c\n");
	write(path, "a.txt", "worktree edit\n");
	write(path, "n.txt", "new\n");
	const head = sh(path, "rev-parse", "HEAD");
	const result = await handoff(s, thread.id, "local");
	expect(result.branch).toMatch(/^kc\/[a-z0-9-]+$/);
	expect(sh(s.cwd, "symbolic-ref", "--short", "HEAD")).toBe(result.branch);
	expect(sh(s.cwd, "rev-parse", "HEAD")).toBe(head);
	expect(existsSync(join(s.cwd, "c.txt"))).toBe(true);
	expect(status(s.cwd)).toBe(" M a.txt\n?? n.txt");
	expect(status(path)).toBe("");
	expect(() => sh(path, "symbolic-ref", "-q", "HEAD")).toThrow();
	expect(sh(path, "rev-parse", "HEAD")).toBe(head);
	expect(sh(s.cwd, "worktree", "list", "--porcelain")).toContain(path.replace(/\\/g, "/"));
	expect(result.thread.cwd).toBe(s.root);
	expect(result.thread.workspace).toEqual({ mode: "local", worktree: path });
	await say(s, thread.id);
});

test("a staged rename whose file was moved back leaves nothing staged in the worktree", async () => {
	const s = await repoServer();
	const { thread, path } = await started(s);
	sh(path, "mv", "a.txt", "b.txt");
	renameSync(join(path, "b.txt"), join(path, "a.txt"));
	await handoff(s, thread.id, "local");
	expect(sh(path, "diff", "--cached", "--name-only")).toBe("");
});

test("a staged edit edited again: the main checkout gets the working version; the staged one is saved", async () => {
	const s = await repoServer();
	const { thread, path } = await started(s);
	write(path, "a.txt", "staged\n");
	sh(path, "add", "a.txt");
	write(path, "a.txt", "working\n");
	await handoff(s, thread.id, "local");
	expect(readFileSync(join(s.cwd, "a.txt"), "utf8")).toBe("working\n");
	expect(status(path)).toBe("");
	const saved = join(s.agentDir, "handoff");
	const staged = readdirSync(saved).find((name) => name.endsWith(".staged.patch"))!;
	expect(readFileSync(join(saved, staged), "utf8")).toContain("+staged");
});

test("a main checkout with local changes refuses; an unrelated ignored file does not", async () => {
	for (const dirty of ["tracked", "untracked", "staged"] as const) {
		const s = await repoServer();
		const { thread, path } = await started(s);
		write(path, "a.txt", "worktree\n");
		if (dirty === "tracked") write(s.cwd, "a.txt", "main edit\n");
		else write(s.cwd, "u.txt", "u\n");
		if (dirty === "staged") sh(s.cwd, "add", "u.txt");
		const before = [checkoutState(s.cwd), checkoutState(path)];
		await expect(handoff(s, thread.id, "local")).rejects.toMatchObject({
			code: "gitConflict",
			data: { reason: "localChanges", recoveryInstructions: ["Stash or commit your local changes to hand off."] },
		});
		expect([checkoutState(s.cwd), checkoutState(path)]).toEqual(before);
	}
	const s = await repoServer({ ".gitignore": "*.log\n" });
	const { thread, path } = await started(s);
	write(path, "a.txt", "worktree\n");
	write(s.cwd, "debug.log", "keep me\n");
	await handoff(s, thread.id, "local");
	expect(readFileSync(join(s.cwd, "debug.log"), "utf8")).toBe("keep me\n");
});

test("a staged rename in the main checkout names both its paths", async () => {
	const s = await repoServer({ "a.txt": "a\n" });
	const { thread, path } = await started(s);
	write(path, "a.txt", "worktree\n");
	sh(s.cwd, "mv", "a.txt", "moved.txt");
	await expect(handoff(s, thread.id, "local")).rejects.toMatchObject({
		data: { reason: "localChanges", paths: ["moved.txt", "a.txt"] },
	});
});

test("an ignored file the handoff would overwrite refuses, naming it", async () => {
	for (const [ignore, local, change] of [
		[".env\n", ".env", ".env"],
		["cache\n", "cache", "cache/x.txt"],
	]) {
		const s = await repoServer({ ".gitignore": ignore });
		const { thread, path } = await started(s);
		write(path, change, "tracked by the worktree\n");
		sh(path, "add", "-f", change);
		sh(path, "commit", "-q", "-m", "track it");
		write(s.cwd, local, "ignored here\n");
		const before = [checkoutState(s.cwd), checkoutState(path)];
		await expect(handoff(s, thread.id, "local")).rejects.toMatchObject({
			data: { reason: "localChanges", paths: [local] },
		});
		expect([checkoutState(s.cwd), checkoutState(path)]).toEqual(before);
	}
});

test("the worktree's own branch moves; a requested name is used; an existing one is branchExists", async () => {
	const s = await repoServer();
	const first = await started(s);
	await s.a.client.request("git/branch/create", { threadId: first.thread.id, name: "feat/x" });
	await handoff(s, first.thread.id, "local");
	expect(sh(s.cwd, "symbolic-ref", "--short", "HEAD")).toBe("feat/x");
	expect(() => sh(first.path, "symbolic-ref", "-q", "HEAD")).toThrow();

	const t = await repoServer();
	sh(t.cwd, "branch", "custom");
	const second = await started(t);
	const before = [checkoutState(t.cwd), checkoutState(second.path)];
	await expect(handoff(t, second.thread.id, "local", { branch: "custom" })).rejects.toMatchObject({
		data: { reason: "branchExists" },
	});
	expect([checkoutState(t.cwd), checkoutState(second.path)]).toEqual(before);
	expect((await handoff(t, second.thread.id, "local", { branch: "fresh" })).branch).toBe("fresh");
});

test("a merge in progress refuses", async () => {
	const s = await repoServer();
	const { thread } = await started(s);
	sh(s.cwd, "checkout", "-q", "-b", "side");
	commitIn(s.cwd, "side.txt", "s\n");
	sh(s.cwd, "checkout", "-q", "main");
	commitIn(s.cwd, "main.txt", "m\n");
	sh(s.cwd, "merge", "-q", "--no-commit", "--no-ff", "side");
	await expect(handoff(s, thread.id, "local")).rejects.toMatchObject({ data: { reason: "operationInProgress" } });
});

test("a failed apply answers recoveryRequired naming the saved patch; the worktree keeps its changes", async () => {
	const s = await repoServer();
	const { thread, path } = await started(s);
	write(path, "a.txt", "worktree\n");
	const before = checkoutState(path);
	const original = workspaceHooks.beforeHandoffApply;
	workspaceHooks.beforeHandoffApply = async () => write(s.cwd, "a.txt", "racing writer\n");
	try {
		const error = (await handoff(s, thread.id, "local").catch((e: unknown) => e)) as {
			data: { reason: string; recoveryInstructions: string[]; patch: string };
		};
		expect(error.data.reason).toBe("recoveryRequired");
		expect(existsSync(error.data.patch)).toBe(true);
		expect(error.data.recoveryInstructions[0]).toContain(error.data.patch);
	} finally {
		workspaceHooks.beforeHandoffApply = original;
	}
	expect(checkoutState(path)).toEqual(before);
	// The main checkout is back on its branch and the new one is gone, so a retry is not branchExists.
	expect(sh(s.cwd, "branch", "--show-current")).toBe("main");
	expect(sh(s.cwd, "branch", "--list", "kc/*")).toBe("");
	sh(s.cwd, "checkout", "-q", "--", "a.txt");
	expect((await handoff(s, thread.id, "local")).branch).toMatch(/^kc\//);
});

test("round trip: local, back to the worktree, local again fast-forwards the branch", async () => {
	for (const switchedAway of [false, true]) {
		const s = await repoServer();
		const { thread, path } = await started(s);
		const { branch } = await handoff(s, thread.id, "local");
		write(s.cwd, "a.txt", "edited locally\n");
		const back = await handoff(s, thread.id, "worktree");
		expect(back.thread.workspace.mode).toBe("worktree");
		expect(back.thread.cwd).toBe(thread.cwd);
		expect(status(path)).toBe(" M a.txt");
		expect(status(s.cwd)).toBe("");
		expect(sh(s.cwd, "symbolic-ref", "--short", "HEAD")).toBe(branch);
		sh(path, "commit", "-q", "-am", "worktree commit");
		const head = sh(path, "rev-parse", "HEAD");
		if (switchedAway) sh(s.cwd, "switch", "-q", "main");
		const again = await handoff(s, thread.id, "local");
		expect(again.branch).toBe(branch);
		expect(sh(s.cwd, "symbolic-ref", "--short", "HEAD")).toBe(branch);
		expect(sh(s.cwd, "rev-parse", "HEAD")).toBe(head);
	}
});

test("a sibling chat's commit in the worktree is kept when the owner comes back", async () => {
	const s = await repoServer();
	const { thread, path } = await started(s);
	await handoff(s, thread.id, "local");
	commitIn(path, "sibling.txt", "s\n", "sibling work");
	const sibling = sh(path, "rev-parse", "HEAD");
	const { warnings } = await handoff(s, thread.id, "worktree");
	const kept = sh(s.cwd, "for-each-ref", "--format=%(objectname)", "refs/knightcode/kept/");
	expect(kept.split("\n")).toContain(sibling);
	expect(warnings.some((w) => w.message.includes(sibling.slice(0, 7)))).toBe(true);
});

test("a thread born in the main checkout reuses its worktree and resumes where it was placed after a restart", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await say(s, thread.id);
	const first = await handoff(s, thread.id, "worktree");
	if (first.thread.workspace.mode !== "worktree") throw new Error("expected a worktree");
	const path = first.thread.workspace.path;
	expect(first.thread.cwd).toBe(path);
	const local = await handoff(s, thread.id, "local");
	expect(local.thread.workspace).toEqual({ mode: "local", worktree: path });
	expect(local.thread.cwd).toBe(s.root);
	const again = await handoff(s, thread.id, "worktree");
	expect(again.thread.workspace).toMatchObject({ mode: "worktree", path });
	await s.threads.closeAll();
	const next = await startServer({ agentDir: s.agentDir, sessionDir: s.sessionDir });
	const b = await next.connect("desktop");
	const resumed = await b.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.thread.cwd).toBe(path);
});

test("an unknown environment is invalidParams before any worktree is created", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await say(s, thread.id);
	await expect(handoff(s, thread.id, "worktree", { environment: "does-not-exist" })).rejects.toMatchObject({
		code: "invalidParams",
	});
	expect((await s.a.client.request("worktree/list", { cwd: s.cwd })).worktrees).toEqual([]);
});

test("a handoff refused for a busy main checkout or a merge creates no worktree", async () => {
	const held = createHeldTurn();
	const s = await repoServer(undefined, { extraExtensions: [{ name: "held", factory: held.extension }] });
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await say(s, thread.id);
	const { thread: busy } = await s.a.client.request("thread/start", { cwd: s.cwd, approvalMode: "fullAccess" });
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await s.a.client.request("turn/start", { threadId: busy.id, text: "hold" });
	await held.entered;
	try {
		// Twice: a retry must not leave a second worktree either.
		for (let i = 0; i < 2; i++)
			await expect(handoff(s, thread.id, "worktree")).rejects.toMatchObject({ code: "turnInProgress" });
	} finally {
		held.release();
	}
	await s.a.waitFor("turn/completed");
	// git refuses to write a pseudoref; the file is what marks a merge in progress.
	writeFileSync(
		sh(s.cwd, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"),
		sh(s.cwd, "rev-parse", "HEAD"),
	);
	await expect(handoff(s, thread.id, "worktree")).rejects.toMatchObject({ data: { reason: "operationInProgress" } });
	expect((await s.a.client.request("worktree/list", { cwd: s.cwd })).worktrees).toEqual([]);
});

test("a handoff that fails after creating its worktree removes it, so retries do not stack worktrees", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await say(s, thread.id);
	write(s.cwd, "a.txt", "local edit\n");
	const original = workspaceHooks.beforeHandoffApply;
	workspaceHooks.beforeHandoffApply = async () => {
		throw new Error("refused late");
	};
	try {
		for (let i = 0; i < 2; i++) await expect(handoff(s, thread.id, "worktree")).rejects.toBeInstanceOf(Error);
	} finally {
		workspaceHooks.beforeHandoffApply = original;
	}
	expect((await s.a.client.request("worktree/list", { cwd: s.cwd })).worktrees).toEqual([]);
	// The changes never left the main checkout.
	expect(readFileSync(join(s.cwd, "a.txt"), "utf8")).toBe("local edit\n");
});

test("a second handoff of a thread while one runs is turnInProgress and builds no second worktree", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await say(s, thread.id);
	const first = handoff(s, thread.id, "worktree");
	await expect(handoff(s, thread.id, "worktree")).rejects.toMatchObject({ code: "turnInProgress" });
	await first;
	expect((await s.a.client.request("worktree/list", { cwd: s.cwd })).worktrees).toHaveLength(1);
});

test("a handed-off worktree thread resumes in the main checkout after a restart and lists as local", async () => {
	const s = await repoServer();
	const { thread } = await started(s);
	await handoff(s, thread.id, "local");
	await s.threads.closeAll();
	const next = await startServer({ agentDir: s.agentDir, sessionDir: s.sessionDir });
	const b = await next.connect("desktop");
	expect((await b.client.request("thread/resume", { threadId: thread.id })).thread.cwd).toBe(s.root);
	const listed = await b.client.request("thread/list", { cwd: s.cwd });
	expect(listed.threads.find((t) => t.id === thread.id)).toMatchObject({ workspaceMode: "local", projectCwd: s.root });
});

test("a busy thread in either checkout refuses with turnInProgress", async () => {
	for (const where of ["worktree", "main"] as const) {
		const held = createHeldTurn();
		const s = await repoServer(undefined, { extraExtensions: [{ name: "held", factory: held.extension }] });
		const { thread, path } = await started(s);
		write(path, "a.txt", "x\n");
		const { thread: busy } = await s.a.client.request("thread/start", {
			cwd: where === "worktree" ? path : s.cwd,
			approvalMode: "fullAccess",
		});
		s.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("ok")]),
		]);
		await s.a.client.request("turn/start", { threadId: busy.id, text: "hold" });
		await held.entered;
		const before = [checkoutState(s.cwd), checkoutState(path)];
		try {
			await expect(handoff(s, thread.id, "local")).rejects.toMatchObject({ code: "turnInProgress" });
		} finally {
			held.release();
		}
		expect([checkoutState(s.cwd), checkoutState(path)]).toEqual(before);
	}
});

test("an input queued while the handoff is parked runs once afterwards, in the main checkout", async () => {
	const s = await repoServer();
	const { thread: created } = await s.a.client.request("thread/start", {
		cwd: s.cwd,
		workspace: { mode: "worktree" },
		approvalMode: "fullAccess",
	});
	await say(s, created.id);
	if (created.workspace.mode !== "worktree") throw new Error("unreachable");
	const path = created.workspace.path;
	let release!: () => void;
	let parked!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const entered = new Promise<void>((resolve) => (parked = resolve));
	const original = workspaceHooks.beforeHandoffApply;
	workspaceHooks.beforeHandoffApply = async () => {
		parked();
		await gate;
	};
	let moving: Promise<unknown> | undefined;
	try {
		moving = handoff(s, created.id, "local");
		await entered;
		s.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo queued > queued.txt" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await s.a.client.request("turn/queue/add", { threadId: created.id, text: "after" });
	} finally {
		release();
		workspaceHooks.beforeHandoffApply = original;
	}
	await moving;
	await s.a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === created.id);
	expect(s.a.notifications.filter((n) => n.method === "turn/started")).toHaveLength(2);
	expect(readFileSync(join(s.cwd, "queued.txt"), "utf8").trim()).toBe("queued");
	expect(existsSync(join(path, "queued.txt"))).toBe(false);
});

test("a detached main checkout's own commit is kept under a ref with a warning", async () => {
	const s = await repoServer();
	const { thread } = await started(s);
	sh(s.cwd, "checkout", "-q", "--detach");
	commitIn(s.cwd, "own.txt", "own\n", "detached work");
	const own = sh(s.cwd, "rev-parse", "HEAD");
	const { warnings } = await handoff(s, thread.id, "local");
	expect(sh(s.cwd, "for-each-ref", "--format=%(objectname)", "refs/knightcode/kept/main/").split("\n")).toContain(own);
	expect(warnings.some((w) => w.source === "server" && w.message.includes(own.slice(0, 7)))).toBe(true);
});

test.skipIf(!POSIX)("a path with a tab in its name moves intact", async () => {
	const s = await repoServer();
	const { thread, path } = await started(s);
	write(path, "tab\tname.txt", "t\n");
	await handoff(s, thread.id, "local");
	expect(readFileSync(join(s.cwd, "tab\tname.txt"), "utf8")).toBe("t\n");
});

test("committed work with no uncommitted changes moves; a thread with no message is invalidParams", async () => {
	const s = await repoServer();
	const { thread, path } = await started(s);
	commitIn(path, "c.txt", "c\n");
	const head = sh(path, "rev-parse", "HEAD");
	await handoff(s, thread.id, "local");
	expect(sh(s.cwd, "rev-parse", "HEAD")).toBe(head);
	const { thread: fresh } = await worktreeThread(s);
	const buckets = readdirSync(join(s.agentDir, "worktrees")).length;
	await expect(handoff(s, fresh.id, "local")).rejects.toMatchObject({ code: "invalidParams" });
	const { thread: freshLocal } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await expect(handoff(s, freshLocal.id, "worktree")).rejects.toMatchObject({ code: "invalidParams" });
	expect(readdirSync(join(s.agentDir, "worktrees")).length).toBe(buckets);
});

test("a thread started in pkg/ runs in pkg/ of each checkout", async () => {
	const s = await repoServer({ "pkg/x.txt": "x\n" });
	const { thread, path } = await started(s, {}, join(s.cwd, "pkg"));
	const local = await handoff(s, thread.id, "local");
	expect(local.thread.cwd).toBe(join(realpathSync.native(s.cwd), "pkg"));
	const back = await handoff(s, thread.id, "worktree");
	expect(back.thread.cwd).toBe(join(path, "pkg"));
});
