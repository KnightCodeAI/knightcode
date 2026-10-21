import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { workspaceHooks } from "../../src/app-server/workspaces.ts";
import { checkoutState, sh, write } from "./fixtures/git-repo.ts";
import { repoServer, say, worktreeThread } from "./fixtures/worktree-server.ts";
import { cleanupServers } from "./harness.ts";

afterEach(cleanupServers);

const layouts = [{ name: "explicit session dir" }, { name: "default layout", sessionDir: null }] as const;

test("a plain fork of a worktree thread shares the worktree and does not own it", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	await say(s, thread.id);
	const { thread: fork } = await s.a.client.request("thread/fork", { threadId: thread.id });
	expect(fork.cwd).toBe(thread.cwd);
	expect(fork.workspace).toMatchObject({ mode: "worktree", ownerThreadId: thread.id });
});

test("a fork into a new worktree carries the source worktree's commits and uncommitted edits", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	await say(s, thread.id);
	write(thread.cwd, "committed.txt", "c");
	sh(thread.cwd, "add", "-A");
	sh(thread.cwd, "commit", "-q", "-m", "thread commit");
	write(thread.cwd, "a.txt", "from the source thread\n");
	const { thread: fork } = await s.a.client.request("thread/fork", {
		threadId: thread.id,
		workspace: { mode: "worktree" },
	});
	expect(fork.workspace).toMatchObject({ mode: "worktree", ownerThreadId: fork.id });
	expect(readFileSync(join(fork.cwd, "committed.txt"), "utf8")).toBe("c");
	expect(sh(fork.cwd, "status", "--porcelain")).toBe(" M a.txt");
	expect(readFileSync(join(thread.cwd, "a.txt"), "utf8")).toBe("from the source thread\n"); // the source keeps them
	expect(fork.projectCwd).toBe(s.root);
});

test("a clean source forks into a new worktree; a start inside a worktree's subdirectory keeps it", async () => {
	const s = await repoServer({ "pkg/x.txt": "x" });
	const { thread, workspace } = await worktreeThread(s);
	await say(s, thread.id);
	const { thread: fork } = await s.a.client.request("thread/fork", {
		threadId: thread.id,
		workspace: { mode: "worktree" },
	});
	expect(fork.workspace).toMatchObject({ mode: "worktree", ownerThreadId: fork.id });
	expect(sh(fork.cwd, "status", "--porcelain")).toBe("");
	const nested = await worktreeThread(s, {}, join(workspace.path, "pkg"));
	expect(nested.thread.cwd).toBe(join(nested.workspace.path, "pkg"));
	expect(nested.thread.projectCwd).toBe(s.root);
});

test("a local thread forks into a new worktree with its checkout's uncommitted edits", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await say(s, thread.id);
	write(s.cwd, "a.txt", "edited\n");
	const before = checkoutState(s.cwd);
	const { thread: fork } = await s.a.client.request("thread/fork", {
		threadId: thread.id,
		workspace: { mode: "worktree" },
	});
	expect(fork.workspace).toMatchObject({ mode: "worktree", ownerThreadId: fork.id });
	expect(readFileSync(join(fork.cwd, "a.txt"), "utf8")).toBe("edited\n");
	expect(sh(fork.cwd, "status", "--porcelain")).toBe(" M a.txt");
	expect(checkoutState(s.cwd)).toEqual(before);
});

for (const layout of layouts) {
	test(`a fork into a new worktree that fails to load leaves no transcript and keeps the worktree (${layout.name})`, async () => {
		const s = await repoServer(undefined, "sessionDir" in layout ? { sessionDir: layout.sessionDir } : undefined);
		const { thread } = await worktreeThread(s);
		await say(s, thread.id);
		const original = workspaceHooks.afterForkFrom;
		workspaceHooks.afterForkFrom = async () => {
			throw new Error("injected");
		};
		let error: unknown;
		try {
			error = await s.a.client
				.request("thread/fork", { threadId: thread.id, workspace: { mode: "worktree" } })
				.catch((e: unknown) => e);
		} finally {
			workspaceHooks.afterForkFrom = original;
		}
		const worktree = (error as { data: { worktree: string } }).data.worktree;
		expect(existsSync(worktree)).toBe(true);
		expect(existsSync(join(dirname(worktree), "worktree.json"))).toBe(true);
		const listed = await s.a.client.request("thread/list", { cwd: s.cwd });
		expect(listed.threads.map((t) => t.id)).toEqual([thread.id]);
		// Nothing but the source's transcript is on disk, and nothing holds a lock.
		const files = s.threads.files;
		expect(await files.find(thread.id)).toBeDefined();
		const dir = dirname((await files.find(thread.id))!);
		expect(readdirSync(dir).filter((name) => name.endsWith(".jsonl"))).toHaveLength(1);
		const source = basename((await files.find(thread.id))!);
		expect(readdirSync(dir).filter((name) => name.includes(".lock") && !name.startsWith(source))).toEqual([]);
	});

	test(`every kind of fork of a worktree thread lists under the project (${layout.name})`, async () => {
		const s = await repoServer(undefined, "sessionDir" in layout ? { sessionDir: layout.sessionDir } : undefined);
		const { thread } = await worktreeThread(s);
		await say(s, thread.id);
		const { thread: plain } = await s.a.client.request("thread/fork", { threadId: thread.id });
		const { thread: worktree } = await s.a.client.request("thread/fork", {
			threadId: thread.id,
			workspace: { mode: "worktree" },
		});
		for (const id of [thread.id, plain.id, worktree.id]) await s.threads.unload(id);
		const listed = await s.a.client.request("thread/list", { cwd: s.cwd });
		expect(listed.threads.map((t) => t.id).sort()).toEqual([thread.id, plain.id, worktree.id].sort());
		expect(listed.threads.every((t) => t.projectCwd === s.root)).toBe(true);
	});
}

function replacements(knightcode: ExtensionAPI): void {
	knightcode.registerCommand("fresh", {
		description: "new session",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
	knightcode.registerCommand("refork", {
		description: "fork at the first user entry",
		handler: async (_args, ctx) => {
			const first = ctx.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "user");
			await ctx.fork(first!.id);
		},
	});
}

test("an extension's newSession and empty fork from a worktree thread stay in the worktree", async () => {
	const s = await repoServer(undefined, { extraExtensions: [{ name: "replacements", factory: replacements }] });
	const { thread, workspace } = await worktreeThread(s);
	await say(s, thread.id);
	const expected = {
		projectCwd: s.root,
		workspace: { mode: "worktree", path: workspace.path, ownerThreadId: thread.id },
	};
	await s.a.client.request("turn/start", { threadId: thread.id, text: "/fresh" });
	const fresh = await s.a.waitFor("thread/replaced", (p) => p.oldThreadId === thread.id);
	expect(fresh.thread).toMatchObject(expected);
	const next = (fresh.thread as { id: string }).id;
	await say(s, next);
	await s.a.client.request("turn/start", { threadId: next, text: "/refork" });
	const forked = await s.a.waitFor("thread/replaced", (p) => p.oldThreadId === next);
	expect(forked.thread).toMatchObject(expected);
});
