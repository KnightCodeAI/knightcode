import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	childEnv,
	countUntracked,
	git,
	headTree,
	machineApply,
	machinePatch,
	repoOf,
	runProcess,
	snapshotTree,
	turnSnapshot,
	withRepoLock,
} from "../../src/app-server/git.ts";
import { readDiff } from "../../src/app-server/diff.ts";
import { checkoutState, makeRepo, sh, write } from "./fixtures/git-repo.ts";
import { cleanupServers, tempDir } from "./harness.ts";

const saved = { ...process.env };
afterEach(async () => {
	for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
	Object.assign(process.env, saved);
	await cleanupServers();
});

function repoDir() {
	const dir = tempDir("kc-git-");
	makeRepo(dir);
	return dir;
}

test("inherited GIT_DIR and GIT_INDEX_FILE, in any letter case on Windows, do not redirect the server's git", async () => {
	const dir = repoDir();
	const other = repoDir();
	const dirName = process.platform === "win32" ? "Git_Dir" : "GIT_DIR";
	const indexName = process.platform === "win32" ? "git_index_file" : "GIT_INDEX_FILE";
	process.env[dirName] = join(other, ".git");
	process.env[indexName] = join(other, ".git", "index");
	expect(Object.keys(childEnv()).some((k) => k.toUpperCase() === "GIT_DIR")).toBe(false);
	for (const name of ["GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"]) process.env[name] = "1";
	await git(dir, ["add", "--", "a.txt"]); // fails if any of them reached git beside GIT_LITERAL_PATHSPECS
	const repo = await repoOf(dir);
	expect(repo?.root).toBe(realpathSync.native(dir));
	write(dir, "new.txt", "x");
	expect(sh(dir, "ls-tree", "--name-only", await snapshotTree(repo!, true)).split("\n")).toContain("new.txt");
});

test("a turn snapshot past 500 untracked files leaves out a folder of 200 or more, read over several chunks", async () => {
	const dir = repoDir();
	const repo = (await repoOf(dir))!;
	// 501 long names: about 80 KB of listing, so paths straddle the pipe's chunks.
	for (let i = 0; i < 501; i++) write(dir, `frames/${"f".repeat(150)}${i}.txt`, "x");
	write(dir, "small/kept.txt", "k");
	write(dir, "a.txt", "edited\n");
	const trees = await turnSnapshot(repo, 500);
	expect(trees.skip).toEqual(["frames/"]);
	expect(sh(dir, "ls-tree", "-r", "--name-only", trees.all!).split("\n")).toEqual(["a.txt", "small/kept.txt"]);
	expect(sh(dir, "ls-tree", "-r", "--name-only", trees.tracked).split("\n")).toEqual(["a.txt"]);
	expect(sh(dir, "show", `${trees.all}:a.txt`)).toBe("edited");
});

test("a snapshot never writes the real index and sees a second edit to an already modified file", async () => {
	const dir = repoDir();
	const repo = (await repoOf(dir))!;
	write(dir, "a.txt", "one\nTWO\nthree\n");
	const index = readFileSync(join(dir, ".git", "index"));
	const first = await snapshotTree(repo, true);
	write(dir, "a.txt", "one\nTWO\nTHREE\n");
	const second = await snapshotTree(repo, true);
	expect(second).not.toBe(first);
	expect(readFileSync(join(dir, ".git", "index")).equals(index)).toBe(true);
});

test("a snapshot sees a same-size edit that only the index's age marks as possibly changed", async () => {
	const dir = repoDir();
	// Whole-second timestamps, as git on Linux compares them; Git for Windows would see nanoseconds differ.
	sh(dir, "config", "core.checkStat", "minimal");
	const file = join(dir, "a.txt");
	const index = join(dir, ".git", "index");
	const past = new Date(Date.now() - 10_000);
	utimesSync(file, past, past);
	sh(dir, "add", "a.txt");
	// The index written in the second the file was: git must compare that entry's content, not its stat.
	utimesSync(index, past, past);
	writeFileSync(file, "one\nTWO\nthree\n");
	utimesSync(file, past, past);
	const repo = (await repoOf(dir))!;
	expect(await snapshotTree(repo, true)).not.toBe(await headTree(repo));
});

test("an assume-unchanged file's edit is still in the snapshot; the real flag stays set", async () => {
	const dir = repoDir();
	sh(dir, "update-index", "--assume-unchanged", "a.txt");
	write(dir, "a.txt", "changed\n");
	const tree = await snapshotTree((await repoOf(dir))!, true);
	expect(sh(dir, "cat-file", "blob", `${tree}:a.txt`)).toBe("changed");
	expect(sh(dir, "ls-files", "-v", "a.txt")).toBe("h a.txt");
});

test("tracked-only snapshots leave untracked files out", async () => {
	const dir = repoDir();
	write(dir, "u.txt", "untracked");
	expect(sh(dir, "ls-tree", "--name-only", await snapshotTree((await repoOf(dir))!, false))).not.toContain("u.txt");
});

test("a size limit leaves large untracked files out of a snapshot, never tracked ones", async () => {
	const dir = repoDir();
	write(dir, "big.bin", "x".repeat(2048));
	write(dir, "small.txt", "s");
	write(dir, "a.txt", "y".repeat(4096));
	const repo = (await repoOf(dir))!;
	const names = async (limit?: number) =>
		sh(dir, "ls-tree", "--name-only", await snapshotTree(repo, true, undefined, limit)).split("\n");
	expect(await names(1024)).toEqual(["a.txt", "small.txt"]);
	expect(await names()).toEqual(["a.txt", "big.bin", "small.txt"]);
});

test("countUntracked stops at limit + 1", async () => {
	const dir = repoDir();
	for (let i = 0; i < 20; i++) write(dir, `u/${i}.txt`, String(i));
	expect(await countUntracked((await repoOf(dir))!, 5)).toBe(6);
});

test("pathspecs are literal", async () => {
	const dir = repoDir();
	write(dir, "a[1].txt", "1");
	write(dir, "a1.txt", "1");
	await git(dir, ["add", "--", "a[1].txt"]);
	expect(sh(dir, "status", "--porcelain")).toBe("A  a[1].txt\n?? a1.txt");
});

test("outside a work tree repoOf is undefined; a subdirectory has a prefix; a linked worktree shares the common dir", async () => {
	expect(await repoOf(tempDir("kc-nogit-"))).toBeUndefined();
	const dir = repoDir();
	write(dir, "pkg/x.txt", "x");
	sh(dir, "add", "-A");
	sh(dir, "commit", "-q", "-m", "pkg");
	expect((await repoOf(join(dir, "pkg")))?.prefix).toBe("pkg");
	const linked = join(tempDir("kc-wt-"), "w");
	sh(dir, "worktree", "add", "-q", linked);
	const [main, wt] = [(await repoOf(dir))!, (await repoOf(linked))!];
	expect(wt.commonDir).toBe(main.commonDir);
	expect(wt.gitDir).not.toBe(main.gitDir);
});

test("withRepoLock runs one operation per repository at a time, in order", async () => {
	const repo = (await repoOf(repoDir()))!;
	const order: string[] = [];
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const first = withRepoLock(repo, async () => {
		order.push("first:start");
		await gate;
		order.push("first:end");
	});
	const second = withRepoLock(repo, async () => void order.push("second"));
	await Promise.resolve();
	expect(order).toEqual(["first:start"]);
	release();
	await Promise.all([first, second]);
	expect(order).toEqual(["first:start", "first:end", "second"]);
});

test("aborting a process ends the call within its bound; POSIX confirms the whole group gone", async () => {
	const dir = tempDir("kc-proc-");
	const pidFile = join(dir, "child.pid");
	const [command, args] =
		process.platform === "win32"
			? [
					"powershell",
					[
						"-NoProfile",
						"-Command",
						`$p = Start-Process ping -ArgumentList '-n','600','127.0.0.1' -PassThru -WindowStyle Hidden; Set-Content '${pidFile}' $p.Id; Wait-Process -Id $p.Id`,
					],
				]
			: ["sh", ["-c", `sleep 600 & echo $! > '${pidFile}'; wait`]];
	const controller = new AbortController();
	const running = runProcess(command as string, args as string[], { cwd: dir, signal: controller.signal });
	await expect
		.poll(() => readFileSync(pidFile, { encoding: "utf8", flag: "a+" }).trim(), { timeout: 15_000 })
		.not.toBe("");
	const pid = Number(readFileSync(pidFile, "utf8"));
	const began = Date.now();
	controller.abort();
	try {
		if (process.platform === "win32") {
			await expect(running).rejects.toMatchObject({ name: "ProcessKillUnconfirmed" });
		} else {
			await expect(running).rejects.toMatchObject({ name: "ProcessKilled" });
			expect(() => process.kill(pid, 0)).toThrow();
		}
		expect(Date.now() - began).toBeLessThan(25_000);
	} finally {
		try {
			process.kill(pid, "SIGKILL"); // a survivor on Windows is the test's to clean up
		} catch {}
	}
}, 40_000);

test("the fixture ignores an inherited object directory and global hooks", async () => {
	const other = repoDir();
	const objects = () => sh(other, "count-objects", "-v");
	const before = objects();
	const hooks = tempDir("kc-hooks-");
	const marker = join(hooks, "marker");
	writeFileSync(join(hooks, "post-commit"), `#!/bin/sh\necho ran > '${marker.replace(/\\/g, "/")}'\n`, { mode: 0o755 });
	const globalConfig = join(hooks, "gitconfig");
	writeFileSync(globalConfig, `[core]\n\thooksPath = ${hooks.replace(/\\/g, "/")}\n`);
	process.env.GIT_OBJECT_DIRECTORY = join(other, ".git", "objects");
	process.env.GIT_CONFIG_GLOBAL = globalConfig;
	const dir = tempDir("kc-git-");
	makeRepo(dir);
	expect(objects()).toBe(before);
	expect(existsSync(marker)).toBe(false);
	expect(existsSync(join(dir, ".git", "objects", "pack")) || existsSync(join(dir, ".git", "objects"))).toBe(true);
});

test("checkoutState handles a fresh repository and an unborn branch with a staged file", () => {
	const dir = tempDir("kc-git-");
	sh(dir, "init", "-q", "-b", "main");
	const fresh = checkoutState(dir);
	expect(fresh.head).toBeNull();
	expect(checkoutState(dir)).toEqual(fresh);
	write(dir, "a.txt", "a");
	sh(dir, "add", "a.txt");
	const staged = checkoutState(dir);
	expect(staged.head).toBeNull();
	expect(checkoutState(dir)).toEqual(staged);
	write(dir, "b.txt", "b");
	sh(dir, "add", "b.txt");
	expect(checkoutState(dir)).not.toEqual(staged);
});

test("checkoutState sees a same-size edit made within the second of the checkout", async () => {
	const dir = repoDir();
	write(dir, "a.txt", "worktree edit\n"); // as long as "one\ntwo\nthree\n"
	// Read a second later, as a test does after a request: the index copy is then newer than the edit.
	await new Promise((resolve) => setTimeout(resolve, 1100));
	expect(sh(dir, "ls-tree", checkoutState(dir).trackedTree, "a.txt")).toContain(sh(dir, "hash-object", "a.txt"));
});

test("checkoutState sees a rewritten assume-unchanged file", async () => {
	const dir = repoDir();
	sh(dir, "update-index", "--assume-unchanged", "a.txt");
	const before = checkoutState(dir);
	write(dir, "a.txt", "rewritten\n");
	expect(checkoutState(dir)).not.toEqual(before);
});

test("checkoutState sees an ignored descendant change, a removed ignored file and a mode change", async () => {
	const dir = repoDir();
	write(dir, ".gitignore", "build/\n");
	write(dir, "build/a.js", "a");
	write(dir, "build/b.js", "b");
	const before = checkoutState(dir);
	write(dir, "build/a.js", "A");
	expect(checkoutState(dir)).not.toEqual(before);
	write(dir, "build/a.js", "a");
	rmSync(join(dir, "build/b.js"));
	expect(checkoutState(dir)).not.toEqual(before);
	if (process.platform !== "win32") {
		write(dir, "build/b.js", "b");
		chmodSync(join(dir, "a.txt"), 0o755);
		expect(checkoutState(dir)).not.toEqual(before);
	}
});

test("machineApply keeps whitespace exactly under hostile apply config", async () => {
	const dir = repoDir();
	sh(dir, "config", "apply.whitespace", "fix");
	sh(dir, "config", "apply.ignoreWhitespace", "change");
	const repo = (await repoOf(dir))!;
	write(dir, "a.txt", "one\ntwo  \nthree\n"); // trailing spaces the reviewed diff shows
	const patch = await machinePatch(repo, await headTree(repo), await snapshotTree(repo, true), { binary: true });
	sh(dir, "checkout", "--", "a.txt");
	expect((await machineApply(dir, patch, {})).code).toBe(0);
	expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\ntwo  \nthree\n");
});

test("an empty patch applies as a no-op without starting git", async () => {
	expect((await machineApply(join(tmpdir(), "kc-does-not-exist"), Buffer.alloc(0), { check: true })).code).toBe(0);
});

test("stderr is kept as a bounded tail", async () => {
	const dir = tempDir("kc-proc-");
	const result = await runProcess(
		process.execPath,
		["-e", "process.stderr.write('x'.repeat(5 * 1024 * 1024) + 'END')"],
		{
			cwd: dir,
			stderrTailBytes: 1024,
		},
	);
	expect(result.stderr.length).toBeLessThanOrEqual(1024);
	expect(result.stderr.endsWith("END")).toBe(true);
});

test("a missing command is toolMissing", async () => {
	await expect(runProcess("kc-no-such-tool", [], { cwd: tmpdir() })).rejects.toMatchObject({ code: "toolMissing" });
});

test("stdout past maxStdoutBytes kills the process and throws OutputTooLarge", async () => {
	const script = "setInterval(() => process.stdout.write('x'.repeat(65536)), 1)";
	await expect(
		runProcess(process.execPath, ["-e", script], { cwd: tmpdir(), maxStdoutBytes: 1024 * 1024 }),
	).rejects.toMatchObject({ name: "OutputTooLarge" });
}, 30_000);

test("a descendant that outlives its parent: POSIX kills and confirms it; Windows reports unconfirmed within the bound", async () => {
	const dir = tempDir("kc-proc-");
	const pidFile = join(dir, "grandchild.pid");
	// The grandchild inherits the child's stdout, so the child's `close` never fires on its own.
	const child = [
		"const { spawn } = require('node:child_process');",
		"const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });",
		`require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
		// Node on Windows does not hand an inherited pipe to the grandchild, so there the child stays to keep it open.
		process.platform === "win32" ? "setInterval(() => {}, 1000);" : "process.exit(0);",
	].join("\n");
	const controller = new AbortController();
	const running = runProcess(process.execPath, ["-e", child], { cwd: dir, signal: controller.signal });
	await expect
		.poll(() => readFileSync(pidFile, { encoding: "utf8", flag: "a+" }).trim(), { timeout: 15_000 })
		.not.toBe("");
	const pid = Number(readFileSync(pidFile, "utf8"));
	const began = Date.now();
	controller.abort();
	try {
		if (process.platform === "win32") {
			await expect(running).rejects.toMatchObject({ name: "ProcessKillUnconfirmed" });
		} else {
			await expect(running).rejects.toMatchObject({ name: "ProcessKilled" });
			expect(() => process.kill(pid, 0)).toThrow();
		}
		expect(Date.now() - began).toBeLessThan(25_000);
	} finally {
		try {
			process.kill(pid, "SIGKILL");
		} catch {}
	}
}, 40_000);

test("hostile diff environment and config do not change machine patches", async () => {
	const lines = (changed: string) => ["1", "2", "3", changed, "5", "6", "7", ""].join("\n");
	const dir = tempDir("kc-git-");
	makeRepo(dir, { "a.txt": lines("4"), "b.txt": lines("4") });
	mkdirSync(join(dir, "cfg"));
	writeFileSync(join(dir, "cfg", "order"), "b.txt\na.txt\n");
	sh(dir, "config", "diff.orderFile", join(dir, "cfg", "order").replace(/\\/g, "/"));
	sh(dir, "config", "diff.outputIndicatorNew", ">");
	process.env.GIT_DIFF_OPTS = "-u0";
	write(dir, "a.txt", lines("four"));
	write(dir, "b.txt", lines("four"));
	const repo = (await repoOf(dir))!;
	const patch = (await machinePatch(repo, await headTree(repo), await snapshotTree(repo, false), {})).toString("utf8");
	expect(patch.indexOf("a/a.txt")).toBeLessThan(patch.indexOf("a/b.txt"));
	expect(patch.match(/^@@ -1,7 \+1,7 @@/gm)).toHaveLength(2);
	expect(patch).toContain("\n+four\n");
	expect(patch).toContain("\n-4\n");
	const read = await readDiff(
		repo,
		{ from: await headTree(repo), to: await snapshotTree(repo, false) },
		{ context: 3 },
	);
	expect(read.files.map((f) => [f.path, f.hunks.length])).toEqual([
		["a.txt", 1],
		["b.txt", 1],
	]);
	expect((await machineApply(dir, Buffer.from(patch), { reverse: true })).code).toBe(0);
	expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(lines("4"));
	expect(sh(dir, "status", "--porcelain", "--untracked-files=no")).toBe("");
});

test("git() rejects with GitError carrying stderr", async () => {
	await expect(git(repoDir(), ["rev-parse", "--verify", "nope^{commit}"])).rejects.toMatchObject({ name: "GitError" });
});
