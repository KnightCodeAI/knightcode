import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { cleanupServers, tempDir } from "./harness.ts";
import { repoServer, say, worktreeThread } from "./fixtures/worktree-server.ts";
import { sh, write } from "./fixtures/git-repo.ts";

afterEach(cleanupServers);

test("a PR retry refuses a newer HEAD even when its own commit was skipped", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	const target = { threadId: thread.id, cwd: thread.cwd, projectCwd: thread.projectCwd };
	const first = await s.a.client.request("desktopOperation/start", {
		target,
		action: { kind: "pullRequest", branch: "test/pr-head", commitFirst: false },
	});
	expect(first.operation).toMatchObject({ status: "partial", recovery: "retry" });
	write(thread.cwd, "a.txt", "new HEAD\n");
	sh(thread.cwd, "add", "a.txt");
	sh(thread.cwd, "commit", "-m", "outside workflow");
	const remote = join(tempDir("s7-pr-head-origin-"), "remote.git");
	sh(s.cwd, "init", "--bare", remote);
	sh(s.cwd, "remote", "add", "origin", remote);
	const retry = await s.a.client.request("desktopOperation/recover", {
		target,
		id: first.operation.id,
		action: "retry",
	});
	expect(retry.operation).toMatchObject({ status: "partial", problem: { code: "gitConflict" } });
});

test("two clients retain branch and commit outputs and resume only push after partial success", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	const target = { threadId: thread.id, cwd: thread.cwd, projectCwd: thread.projectCwd };
	write(thread.cwd, "a.txt", "changed\n");
	const pending = await s.a.client.request("desktopOperation/start", {
		target,
		action: {
			kind: "commitAndPush",
			branch: "test/confirmed",
			message: "one commit",
			includeUnstaged: true,
		},
	});
	expect(pending.operation).toMatchObject({
		status: "partial",
		completed: ["branch", "commit"],
		outputs: { branch: "test/confirmed", message: "one commit" },
		recovery: "retry",
	});
	const second = await s.connect("desktop");
	const observed = await second.client.request("desktopOperation/read", { threadId: thread.id });
	expect(observed.operations).toEqual([pending.operation]);
	const remote = join(tempDir("s7-origin-"), "remote.git");
	sh(s.cwd, "init", "--bare", remote);
	sh(s.cwd, "remote", "add", "origin", remote);
	const recovered = await second.client.request("desktopOperation/recover", {
		target,
		id: pending.operation.id,
		action: "retry",
	});
	expect(recovered.operation).toMatchObject({ status: "completed", completed: ["branch", "commit", "push"] });
	expect(sh(thread.cwd, "rev-parse", "HEAD")).toBe(pending.operation.outputs.commit);
	expect(sh(s.cwd, "--git-dir", remote, "rev-parse", "refs/heads/test/confirmed")).toBe(
		pending.operation.outputs.commit,
	);
});

test("a confirmed branch survives a failed commit and retry refuses a checkout that changed", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	const target = { threadId: thread.id, cwd: thread.cwd, projectCwd: thread.projectCwd };
	const first = await s.a.client.request("desktopOperation/start", {
		target,
		action: {
			kind: "commit",
			branch: "test/kept",
			message: "after edits",
			includeUnstaged: true,
		},
	});
	expect(first.operation).toMatchObject({ status: "partial", completed: ["branch"], outputs: { branch: "test/kept" } });
	write(thread.cwd, "a.txt", "now changed\n");
	const done = await s.a.client.request("desktopOperation/recover", {
		target,
		id: first.operation.id,
		action: "retry",
	});
	expect(done.operation).toMatchObject({ status: "completed", completed: ["branch", "commit"] });
	expect(sh(thread.cwd, "branch", "--show-current")).toBe("test/kept");

	write(thread.cwd, "a.txt", "another edit\n");
	const failedPush = await s.a.client.request("desktopOperation/start", {
		target,
		action: {
			kind: "commitAndPush",
			message: "second",
			includeUnstaged: true,
		},
	});
	const remote = join(tempDir("s7-changed-origin-"), "remote.git");
	sh(s.cwd, "init", "--bare", remote);
	sh(s.cwd, "remote", "add", "origin", remote);
	sh(thread.cwd, "switch", "-c", "manual/change");
	const refused = await s.a.client.request("desktopOperation/recover", {
		target,
		id: failedPush.operation.id,
		action: "retry",
	});
	expect(refused.operation).toMatchObject({ status: "partial", problem: { code: "gitConflict" } });
});

test("PR options, nothing-to-commit and generated fill use a real tool stand-in without replay on ambiguous failure", async () => {
	const dir = tempDir("s7-gh-");
	const script = join(dir, "gh.cjs");
	const record = join(dir, "calls.json");
	const fail = join(dir, "fail");
	writeFileSync(
		script,
		`const fs = require('node:fs'); const p = ${JSON.stringify(record)};
const calls = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
calls.push(process.argv.slice(2)); fs.writeFileSync(p, JSON.stringify(calls));
if (fs.existsSync(${JSON.stringify(fail)})) { console.error('request did not confirm'); process.exit(1); }
console.log('https://github.com/example/repo/pull/1');`,
	);
	const s = await repoServer(undefined, { ghCommand: [process.execPath, script] });
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	const target = { threadId: thread.id, cwd: thread.cwd, projectCwd: thread.projectCwd };
	const remote = join(tempDir("s7-pr-origin-"), "remote.git");
	sh(s.cwd, "init", "--bare", remote);
	sh(s.cwd, "remote", "add", "origin", remote);
	const first = await s.a.client.request("desktopOperation/start", {
		target,
		action: {
			kind: "pullRequest",
			commitFirst: true,
			title: "Supplied title",
			body: "Supplied body",
			draft: true,
		},
	});
	expect(first.operation).toMatchObject({
		status: "completed",
		outputs: { url: "https://github.com/example/repo/pull/1" },
	});
	expect(JSON.parse(readFileSync(record, "utf8"))).toEqual([
		["pr", "create", "--head", "main", "--title", "Supplied title", "--body", "Supplied body", "--draft"],
	]);
	writeFileSync(fail, "");
	const next = await s.a.client.request("desktopOperation/start", {
		target,
		action: { kind: "pullRequest", commitFirst: false },
	});
	expect(next.operation).toMatchObject({ status: "outcome-unknown", recovery: "reconcile", completed: ["push"] });
	await s.a.client.request("desktopOperation/recover", { target, id: next.operation.id, action: "retry" });
	expect(JSON.parse(readFileSync(record, "utf8"))).toHaveLength(2);
});

test("handoff revalidates at execution and stale checkout callbacks cannot mutate the moved thread", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd });
	await say(s, thread.id);
	const target = { threadId: thread.id, cwd: thread.cwd, projectCwd: thread.projectCwd };
	await s.a.client.request("desktopOperation/preflight", { target, to: "worktree" });
	const moved = await s.a.client.request("desktopOperation/start", {
		target,
		action: { kind: "handoff", to: "worktree" },
	});
	expect(moved.operation.status).toBe("completed");
	const refused = await s.a.client.request("desktopOperation/start", {
		target,
		action: { kind: "createBranch", name: "must-not-create" },
	});
	expect(refused.operation).toMatchObject({ status: "refused", problem: { code: "invalidParams" } });
	expect(sh(s.cwd, "branch", "--list", "must-not-create")).toBe("");
});
