import { randomBytes } from "node:crypto";
import { fauxAssistantMessage, fauxText } from "@knightcode/ai";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { workspaceHooks } from "../../src/app-server/workspaces.ts";
import { checkoutState, makeRepo, sh, write } from "./fixtures/git-repo.ts";
import { cleanupServers, startServer, tempDir } from "./harness.ts";
import { repoServer, say, worktreeThread } from "./fixtures/worktree-server.ts";

afterEach(cleanupServers);

const worktreeCount = (dir: string) => sh(dir, "worktree", "list", "--porcelain").split("\n\n").filter(Boolean).length;

test("a worktree thread runs on a detached HEAD at the base SHA, listed under its project, and resumes as one", async () => {
	const s = await repoServer();
	const head = sh(s.cwd, "rev-parse", "HEAD");
	const branches = sh(s.cwd, "branch", "--list");
	const { thread, workspace } = await worktreeThread(s);
	expect(workspace).toMatchObject({ baseRef: head, ownerThreadId: thread.id });
	expect(thread.cwd).toBe(workspace.path);
	expect(thread.projectCwd).toBe(s.root);
	expect(() => sh(thread.cwd, "symbolic-ref", "-q", "HEAD")).toThrow(); // detached
	expect(sh(thread.cwd, "rev-parse", "HEAD")).toBe(head);
	expect(sh(s.cwd, "branch", "--list")).toBe(branches); // no branch created
	expect(workspace.path).toMatch(/[\\/][0-9a-f]{4}[\\/][^\\/]+$/);
	await say(s, thread.id);
	const listed = await s.a.client.request("thread/list", { cwd: s.cwd });
	expect(listed.threads.find((t) => t.id === thread.id)).toMatchObject({
		projectCwd: s.root,
		workspaceMode: "worktree",
	});
	await s.threads.unload(thread.id);
	const read = await s.a.client.request("thread/read", { threadId: thread.id });
	expect(read.thread).toMatchObject({ projectCwd: s.root, workspaceMode: "worktree" });
	expect((await s.a.client.request("thread/resume", { threadId: thread.id })).thread.workspace).toEqual(workspace);
});

test("the manifest exists before the first message, so an unsaved worktree thread is still described", async () => {
	const s = await repoServer();
	const { workspace } = await worktreeThread(s);
	const manifest = JSON.parse(readFileSync(join(dirname(workspace.path), "worktree.json"), "utf8"));
	expect(manifest).toMatchObject({ version: 2, ownerThreadId: workspace.ownerThreadId, placement: {} });
});

test("two worktree threads started together get different buckets", async () => {
	const s = await repoServer();
	const [x, y] = await Promise.all([worktreeThread(s), worktreeThread(s)]);
	expect(dirname(x.workspace.path)).not.toBe(dirname(y.workspace.path));
});

test("a thread started in a subdirectory runs in the same subdirectory of its worktree", async () => {
	const s = await repoServer({ "pkg/x.txt": "x" });
	const { thread, workspace } = await worktreeThread(s, {}, join(s.cwd, "pkg"));
	expect(thread.cwd).toBe(join(workspace.path, "pkg"));
	expect(existsSync(join(thread.cwd, "x.txt"))).toBe(true);
});

test("outside git, worktree mode answers notGitRepo and leaves nothing behind", async () => {
	const s = await startServer();
	const a = await s.connect("desktop");
	await expect(a.client.request("thread/start", { cwd: s.cwd, workspace: { mode: "worktree" } })).rejects.toMatchObject(
		{ code: "notGitRepo" },
	);
	expect(existsSync(join(s.agentDir, "worktrees"))).toBe(false);
});

test("a bad baseRef answers invalidParams and leaves no registration or bucket", async () => {
	const s = await repoServer();
	await expect(worktreeThread(s, { baseRef: "nope" })).rejects.toMatchObject({ code: "invalidParams" });
	expect(worktreeCount(s.cwd)).toBe(1);
	const root = join(s.agentDir, "worktrees");
	expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
});

test("a shared core.worktree naming the main checkout does not let creation write there", async () => {
	const s = await repoServer();
	sh(s.cwd, "config", "extensions.worktreeConfig", "true");
	sh(s.cwd, "config", "core.worktree", s.root.replace(/\\/g, "/"));
	write(s.cwd, "a.txt", "dirty\n");
	const config = readFileSync(join(s.cwd, ".git", "config"));
	const { thread } = await worktreeThread(s);
	expect(readFileSync(join(s.cwd, "a.txt"), "utf8")).toBe("dirty\n");
	expect(readFileSync(join(s.cwd, ".git", "config")).equals(config)).toBe(true);
	expect(readFileSync(join(thread.cwd, "a.txt"), "utf8")).toBe("one\ntwo\nthree\n");
	expect(sh(thread.cwd, "status", "--porcelain")).toBe("");
});

test("creation runs no filter or hook, and a failure inside it rolls back completely", async () => {
	const s = await repoServer({
		"a.txt": "plain\n",
		"b.md": "doc\n",
		".gitattributes": "*.txt filter=x\n*.md filter=x=y\n",
	});
	const markers = tempDir("kc-markers-");
	const marker = (name: string) => join(markers, name).replace(/\\/g, "/");
	sh(s.cwd, "config", "filter.x.smudge", `sh -c 'echo x >> "${marker("x")}"; cat'`);
	sh(s.cwd, "config", "filter.x=y.smudge", `sh -c 'echo xy >> "${marker("xy")}"; cat'`);
	writeFileSync(join(s.cwd, ".git", "hooks", "post-checkout"), `#!/bin/sh\necho ran > "${marker("hook")}"\n`, {
		mode: 0o755,
	});
	const { thread } = await worktreeThread(s);
	expect(readdirSync(markers)).toEqual([]);
	expect(readFileSync(join(thread.cwd, "a.txt"), "utf8")).toBe("plain\n");
	const before = worktreeCount(s.cwd);
	const buckets = readdirSync(join(s.agentDir, "worktrees")).length;
	const original = workspaceHooks.afterWorktreeAdd;
	workspaceHooks.afterWorktreeAdd = async () => {
		throw new Error("injected");
	};
	try {
		await expect(worktreeThread(s)).rejects.toThrow();
	} finally {
		workspaceHooks.afterWorktreeAdd = original;
	}
	expect(worktreeCount(s.cwd)).toBe(before);
	expect(readdirSync(join(s.agentDir, "worktrees")).length).toBe(buckets);
});

test("carryLocalChanges brings the checkout's edits and untracked files as uncommitted changes, not ignored files", async () => {
	const s = await repoServer({ ".gitignore": "secret.txt\n", "a.txt": "one\ntwo\nthree\n" });
	write(s.cwd, "a.txt", "one\nedited\nthree\n");
	write(s.cwd, "new.txt", "untracked");
	write(s.cwd, "secret.txt", "ignored");
	const before = checkoutState(s.cwd);
	const { thread, workspace } = await worktreeThread(s, { carryLocalChanges: true });
	expect(readFileSync(join(thread.cwd, "a.txt"), "utf8")).toBe("one\nedited\nthree\n");
	expect(sh(thread.cwd, "status", "--porcelain")).toBe(" M a.txt\n?? new.txt");
	expect(existsSync(join(thread.cwd, "secret.txt"))).toBe(false);
	expect(workspace.baseRef).toBe(sh(s.cwd, "rev-parse", "HEAD"));
	expect(checkoutState(s.cwd)).toEqual(before);
	await expect(worktreeThread(s, { carryLocalChanges: true, baseRef: "HEAD" })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("carried changes over 64 MiB as a patch are invalidParams saying why, and create nothing", async () => {
	const s = await repoServer();
	// Random bytes: the binary patch deflates them, so only incompressible content passes the cap.
	writeFileSync(join(s.cwd, "big.bin"), randomBytes(66 * 1024 * 1024));
	await expect(worktreeThread(s, { carryLocalChanges: true })).rejects.toMatchObject({
		code: "invalidParams",
		message: expect.stringContaining("64 MiB"),
	});
	expect((await s.a.client.request("worktree/list", { cwd: s.cwd })).worktrees).toEqual([]);
}, 60_000);

test("an unknown model answers invalidParams and keeps the created worktree", async () => {
	const s = await repoServer();
	const error = await s.a.client
		.request("thread/start", { cwd: s.cwd, workspace: { mode: "worktree" }, model: { provider: "nope", id: "nope" } })
		.catch((e: unknown) => e);
	expect(error).toMatchObject({ code: "invalidParams", data: { worktree: expect.any(String) } });
	expect(existsSync((error as { data: { worktree: string } }).data.worktree)).toBe(true);
});

test("a model registered only by the new worktree's trusted extension is selected on a cold start", async () => {
	const extension = [
		"export default function (knightcode) {",
		'\tknightcode.registerProvider("ext", {',
		'\t\tbaseUrl: "http://127.0.0.1:9", apiKey: "key", api: "openai-completions",',
		'\t\tmodels: [{ id: "m", name: "M", reasoning: false, input: ["text"],',
		"\t\t\tcost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }],",
		"\t});",
		"}",
		"",
	].join("\n");
	const s = await repoServer({ ".knightcode/extensions/model.ts": extension });
	await s.a.client.request("project/trust/set", { cwd: s.cwd, trusted: true });
	const { thread } = await s.a.client.request("thread/start", {
		cwd: s.cwd,
		workspace: { mode: "worktree" },
		model: { provider: "ext", id: "m" },
	});
	expect(thread.model).toMatchObject({ provider: "ext", id: "m" });
});

test("the worktree inherits the project's trust decision", async () => {
	const s = await repoServer({ ".knightcode/settings.json": "{}" });
	await s.a.client.request("project/trust/set", { cwd: s.cwd, trusted: true });
	const { warnings } = await worktreeThread(s);
	expect(warnings.filter((w) => w.source === "trust")).toEqual([]);
});

test("worktrees.root moves new worktrees; fetchBeforeCreate brings an upstream commit in", async () => {
	const s = await repoServer();
	const root = realpathSync.native(tempDir("kc-root-"));
	writeFileSync(join(s.agentDir, "settings.json"), JSON.stringify({ worktrees: { root, fetchBeforeCreate: true } }));
	const origin = join(tempDir("kc-origin-"), "origin.git");
	sh(s.cwd, "clone", "-q", "--bare", s.cwd, origin);
	sh(s.cwd, "remote", "add", "origin", origin);
	sh(s.cwd, "fetch", "-q", "origin");
	sh(s.cwd, "branch", "-q", "--set-upstream-to=origin/main", "main");
	const other = join(tempDir("kc-other-"), "c");
	sh(s.cwd, "clone", "-q", origin, other);
	const push = (name: string) => {
		for (const [key, value] of [
			["user.name", "Test"],
			["user.email", "test@example.com"],
			["commit.gpgsign", "false"],
		])
			sh(other, "config", key, value);
		write(other, name, name);
		sh(other, "add", "-A");
		sh(other, "commit", "-q", "-m", name);
		sh(other, "push", "-q", "origin", "main");
		return sh(other, "rev-parse", "HEAD");
	};
	const first = push("first.txt");
	// The fetch's ref lookup takes a revision, never an option.
	await expect(worktreeThread(s, { baseRef: "--git-dir=/elsewhere" })).rejects.toMatchObject({ code: "invalidParams" });
	const remote = await worktreeThread(s, { baseRef: "origin/main" });
	expect(sh(remote.thread.cwd, "rev-parse", "HEAD")).toBe(first);
	expect(remote.workspace.path.startsWith(root)).toBe(true);
	const second = push("second.txt");
	const head = sh(s.cwd, "rev-parse", "HEAD");
	const local = await worktreeThread(s);
	expect(sh(local.thread.cwd, "rev-parse", "HEAD")).toBe(head);
	expect(sh(s.cwd, "rev-parse", "origin/main")).toBe(second);
	sh(s.cwd, "remote", "set-url", "origin", join(tmpdir(), "kc-missing-origin.git"));
	const failed = await worktreeThread(s);
	expect(failed.warnings.some((w) => w.source === "server")).toBe(true);
	expect(existsSync(failed.thread.cwd)).toBe(true);
});

test("in the default session layout, threads started inside a managed worktree list under the project", async () => {
	const s = await repoServer(undefined, { sessionDir: null });
	const { thread, workspace } = await worktreeThread(s);
	await say(s, thread.id);
	const { thread: local } = await s.a.client.request("thread/start", {
		cwd: workspace.path,
		workspace: { mode: "local" },
	});
	expect(local.workspace).toMatchObject({ mode: "worktree", path: workspace.path });
	expect(local.projectCwd).toBe(s.root);
	await say(s, local.id);
	const nested = await worktreeThread(s, {}, workspace.path);
	expect(nested.thread.projectCwd).toBe(s.root);
	await say(s, nested.thread.id);
	for (const id of [thread.id, local.id, nested.thread.id]) await s.threads.unload(id);
	const listed = await s.a.client.request("thread/list", { cwd: s.cwd });
	expect(listed.threads.map((t) => t.id).sort()).toEqual([thread.id, local.id, nested.thread.id].sort());
	expect(listed.threads.every((t) => t.projectCwd === s.root && t.workspaceMode === "worktree")).toBe(true);
	expect(readdirSync(join(s.agentDir, "worktrees")).every((name) => /^[0-9a-f]{4}$/.test(name))).toBe(true);
});

test("local threads list as before", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	expect(thread.workspace).toEqual({ mode: "local" });
	await say(s, thread.id);
	const listed = await s.a.client.request("thread/list", { cwd: s.cwd });
	expect(listed.threads.find((t) => t.id === thread.id)).toMatchObject({ workspaceMode: "local", cwd: thread.cwd });
});
