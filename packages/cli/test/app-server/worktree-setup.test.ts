import { type ChildProcess, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Environment } from "@knightcode/app-server-protocol";
import { afterEach, expect, test } from "vitest";
import { workspaceHooks } from "../../src/app-server/workspaces.ts";
import { attachJsonlLineReader } from "../../src/modes/rpc/jsonl.ts";
import { getShellConfig } from "../../src/utils/shell.ts";
import { makeRepo, sh, write } from "./fixtures/git-repo.ts";
import { type RepoServer, repoServer, worktreeThread } from "./fixtures/worktree-server.ts";
import { cleanupServers } from "./harness.ts";

afterEach(cleanupServers);

const bash = (() => {
	try {
		const config = getShellConfig();
		return /bash/i.test(config.shell) ? config : undefined;
	} catch {
		return undefined;
	}
})();
const WIN = process.platform === "win32";
const platformKey = WIN ? "windows" : process.platform === "darwin" ? "macos" : "linux";
/** A path as the script sees it, compared with the server's form. */
const norm = (path: string) => (WIN ? path.trim().replace(/\\/g, "/").toLowerCase() : path.trim());
const bashPath = (path: string) => path.replace(/\\/g, "/");

async function withEnvironment(s: RepoServer, environments: Environment[], trusted = true) {
	await s.a.client.request("environment/save", { cwd: s.cwd, environments });
	if (trusted) await s.a.client.request("project/trust/set", { cwd: s.cwd, trusted: true });
}

test("environment/save then environment/list round-trips; an invalid file answers invalidParams", async () => {
	const s = await repoServer();
	const node: Environment = {
		name: "node",
		setup: { default: "npm ci", windows: "npm.cmd ci" },
		actions: [{ name: "Run", command: { default: "npm start" } }],
	};
	await s.a.client.request("environment/save", { cwd: s.cwd, environments: [node] });
	expect(await s.a.client.request("environment/list", { cwd: s.cwd })).toEqual({
		environments: [node],
		trusted: false,
	});
	const file = join(s.cwd, ".knightcode", "environments.json");
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, environments: [node] });
	await expect(
		s.a.client.request("environment/save", { cwd: s.cwd, environments: [node, node] }),
	).rejects.toMatchObject({ code: "invalidParams" });
	writeFileSync(file, JSON.stringify({ version: 1, environments: [node, node] }));
	await expect(s.a.client.request("environment/list", { cwd: s.cwd })).rejects.toMatchObject({
		code: "invalidParams",
	});
	rmSync(file);
	expect(await s.a.client.request("environment/list", { cwd: s.cwd })).toEqual({ environments: [], trusted: false });
});

test.skipIf(!bash)(
	"setup runs at the project root with the source and worktree paths, and its platform variant wins",
	async () => {
		const s = await repoServer();
		await withEnvironment(s, [
			{
				name: "e",
				setup: {
					default: 'echo default > "$KNIGHTCODE_WORKTREE_PATH/which.txt"',
					[platformKey]: [
						`(pwd -W 2>/dev/null || pwd) > "${bashPath(join(s.agentDir, "pwd.txt"))}"`,
						`echo "$KNIGHTCODE_SOURCE_TREE_PATH" > "${bashPath(join(s.agentDir, "source.txt"))}"`,
						'echo platform > "$KNIGHTCODE_WORKTREE_PATH/which.txt"',
					].join("\n"),
				},
			},
		]);
		const { thread, workspace } = await worktreeThread(s, { environment: "e" });
		expect(workspace.environment).toBe("e");
		expect(readFileSync(join(thread.cwd, "which.txt"), "utf8").trim()).toBe("platform");
		expect(norm(readFileSync(join(s.agentDir, "pwd.txt"), "utf8"))).toBe(norm(s.root));
		expect(norm(readFileSync(join(s.agentDir, "source.txt"), "utf8"))).toBe(norm(s.root));
	},
);

test("no environment, no setup; an unknown environment is invalidParams before anything is created", async () => {
	const s = await repoServer();
	const marker = join(s.agentDir, "marker");
	await withEnvironment(s, [{ name: "e", setup: { default: `echo x > "${bashPath(marker)}"` } }]);
	await worktreeThread(s);
	expect(existsSync(marker)).toBe(false);
	const buckets = readdirSync(join(s.agentDir, "worktrees")).length;
	await expect(worktreeThread(s, { environment: "nope" })).rejects.toMatchObject({ code: "invalidParams" });
	expect(readdirSync(join(s.agentDir, "worktrees")).length).toBe(buckets);
});

test(".worktreeinclude copies a matching ignored .env and nothing else", async () => {
	const s = await repoServer({ ".gitignore": ".env\nother.log\n", ".worktreeinclude": ".env\n" });
	write(s.cwd, ".env", "KEY=1");
	write(s.cwd, "other.log", "log");
	const { thread } = await worktreeThread(s);
	expect(readFileSync(join(thread.cwd, ".env"), "utf8")).toBe("KEY=1");
	expect(existsSync(join(thread.cwd, "other.log"))).toBe(false);
});

test(".worktreeinclude skips a file the base commit would not ignore", async () => {
	const s = await repoServer({ ".worktreeinclude": ".env\n" });
	const old = sh(s.cwd, "rev-parse", "HEAD");
	write(s.cwd, ".gitignore", ".env\n");
	sh(s.cwd, "add", "-A");
	sh(s.cwd, "commit", "-q", "-m", "ignore .env");
	write(s.cwd, ".env", "KEY=1");
	const { thread, warnings } = await worktreeThread(s, { baseRef: old });
	expect(existsSync(join(thread.cwd, ".env"))).toBe(false);
	expect(warnings.some((w) => w.source === "server" && w.message.includes(".env"))).toBe(true);
});

test(".worktreeinclude never creates or writes anything through a link in the destination", async () => {
	const outside = mkdtempSync(join(tmpdir(), "kc-outside-"));
	writeFileSync(join(outside, "keep.txt"), "keep");
	const s = await repoServer({
		".gitignore": "local.env\n",
		".worktreeinclude": "conf/new/local.env\n",
		"conf/keep.txt": "k",
	});
	let baseRef: string | undefined;
	if (!WIN) {
		sh(s.cwd, "rm", "-q", "-r", "conf");
		symlinkSync(outside, join(s.cwd, "conf"));
		sh(s.cwd, "add", "-A");
		sh(s.cwd, "commit", "-q", "-m", "link");
		baseRef = sh(s.cwd, "rev-parse", "HEAD");
		sh(s.cwd, "rm", "-q", "conf");
		write(s.cwd, "conf/keep.txt", "k");
		sh(s.cwd, "add", "-A");
		sh(s.cwd, "commit", "-q", "-m", "dir");
	}
	write(s.cwd, "conf/new/local.env", "SECRET=1");
	const original = workspaceHooks.beforeInclude;
	if (WIN)
		workspaceHooks.beforeInclude = async (worktree: string) => {
			rmSync(join(worktree, "conf"), { recursive: true, force: true });
			symlinkSync(outside, join(worktree, "conf"), "junction");
		};
	try {
		const { warnings } = await worktreeThread(s, baseRef ? { baseRef } : {});
		expect(readdirSync(outside)).toEqual(["keep.txt"]);
		expect(warnings.some((w) => w.source === "server" && w.message.includes("conf/new/local.env"))).toBe(true);
	} finally {
		workspaceHooks.beforeInclude = original;
	}
});

test.skipIf(!bash)(
	"a failing setup keeps the thread, sets setupFailed, warns with its output and streamed progress",
	async () => {
		const s = await repoServer();
		await withEnvironment(s, [{ name: "e", setup: { default: "echo installing; exit 3" } }]);
		const { thread, workspace, warnings } = await worktreeThread(s, { environment: "e" });
		expect(workspace.setupFailed).toBe(true);
		expect(warnings.some((w) => w.source === "server" && w.message.includes("installing"))).toBe(true);
		const progress = s.a.notifications.filter((n) => n.method === "thread/workspace/progress");
		expect(progress.length).toBeGreaterThan(0);
		expect(progress.every((n) => n.params.threadId === thread.id && n.params.phase === "setup")).toBe(true);
		expect(progress.map((n) => n.params.output).join("")).toContain("installing");
	},
);

test("an untrusted project's environment does not run", async () => {
	const s = await repoServer();
	const marker = join(s.agentDir, "marker");
	await withEnvironment(s, [{ name: "e", setup: { default: `echo x > "${bashPath(marker)}"` } }], false);
	const { workspace, warnings } = await worktreeThread(s, { environment: "e" });
	expect(existsSync(marker)).toBe(false);
	expect(workspace.environment).toBe("e");
	expect(warnings.some((w) => w.source === "trust")).toBe(true);
});

test.skipIf(!bash)(
	"a setup printing 100 MiB ends normally with a bounded warning-free result",
	async () => {
		const s = await repoServer();
		await withEnvironment(s, [
			{ name: "e", setup: { default: "head -c 104857600 /dev/zero | tr '\\0' x; echo; echo done" } },
		]);
		const { workspace } = await worktreeThread(s, { environment: "e" });
		expect(workspace.setupFailed).toBeUndefined();
		const progress = s.a.notifications.filter((n) => n.method === "thread/workspace/progress");
		expect(progress.every((n) => String(n.params.output).length <= 64 * 1024 + 64)).toBe(true);
	},
	120_000,
);

test.skipIf(!bash)("a setup through a stdin-transport shell runs the script", async () => {
	const marker = mkdtempSync(join(tmpdir(), "kc-stdin-"));
	const s = await repoServer(undefined, {
		shellConfig: { shell: bash!.shell, args: ["-s"], commandTransport: "stdin" },
	});
	await withEnvironment(s, [{ name: "e", setup: { default: `echo ran > "${bashPath(join(marker, "ran"))}"` } }]);
	await worktreeThread(s, { environment: "e" });
	expect(readFileSync(join(marker, "ran"), "utf8").trim()).toBe("ran");
});

test.skipIf(!bash)(
	"shutdown during setup kills the setup and keeps the worktree with recovery data",
	async () => {
		const s = await repoServer();
		await withEnvironment(s, [
			{
				name: "e",
				setup: {
					default: 'sleep 600 & echo $! > "$KNIGHTCODE_WORKTREE_PATH/../setup.pid"; echo started; wait',
				},
			},
		]);
		const starting = s.a.client
			.request("thread/start", { cwd: s.cwd, workspace: { mode: "worktree", environment: "e" } })
			.catch((error: unknown) => error);
		await s.a.waitFor("thread/workspace/progress", (p) => String(p.output).includes("started"), 30_000);
		const began = Date.now();
		await s.threads.closeAll();
		expect(Date.now() - began).toBeLessThan(25_000);
		const error = (await starting) as { code: string; data: { worktree: string } };
		expect(error).toMatchObject({ code: "shuttingDown", data: { worktree: expect.any(String) } });
		const worktree = error.data.worktree;
		expect(existsSync(worktree)).toBe(true);
		expect(existsSync(join(dirname(worktree), "worktree.json"))).toBe(true);
		const pidFile = join(dirname(worktree), "setup.pid");
		const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : undefined;
		try {
			if (!WIN && pid) expect(() => process.kill(pid, 0)).toThrow();
		} finally {
			if (pid)
				try {
					process.kill(pid, "SIGKILL");
				} catch {}
		}
	},
	60_000,
);

test.skipIf(!bash)(
	"EOF on a real stdio server during setup answers shuttingDown with data.worktree before the hard exit",
	async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-agent-"));
		const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "knightcode-as-e2e-cwd-")));
		makeRepo(cwd);
		mkdirSync(join(cwd, ".knightcode"));
		writeFileSync(
			join(cwd, ".knightcode", "environments.json"),
			JSON.stringify({ version: 1, environments: [{ name: "e", setup: { default: "echo started; sleep 600" } }] }),
		);
		const child: ChildProcess = spawn(
			"bun",
			["src/cli.ts", "app-server", "-e", join(import.meta.dirname, "fixtures/faux-extension.ts")],
			{
				cwd: join(import.meta.dirname, "../.."),
				env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir },
				stdio: ["pipe", "pipe", "inherit"],
			},
		);
		const lines: Array<Record<string, unknown>> = [];
		const waiters = new Set<() => void>();
		attachJsonlLineReader(child.stdout!, (line) => {
			lines.push(JSON.parse(line));
			for (const wake of [...waiters]) wake();
		});
		const waitFor = (predicate: (m: Record<string, unknown>) => boolean) =>
			new Promise<Record<string, unknown>>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("timed out")), 30_000);
				const check = () => {
					const hit = lines.find(predicate);
					if (!hit) return;
					clearTimeout(timer);
					waiters.delete(check);
					resolve(hit);
				};
				waiters.add(check);
				check();
			});
		const send = (message: unknown) => child.stdin!.write(`${JSON.stringify(message)}\n`);
		const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
		try {
			send({ id: 1, method: "initialize", params: { clientInfo: { name: "e2e", version: "0" }, capabilities: {} } });
			await waitFor((m) => m.id === 1);
			send({ method: "initialized", params: {} });
			send({ id: 2, method: "project/trust/set", params: { cwd, trusted: true } });
			await waitFor((m) => m.id === 2);
			send({ id: 3, method: "thread/start", params: { cwd, workspace: { mode: "worktree", environment: "e" } } });
			await waitFor(
				(m) =>
					m.method === "thread/workspace/progress" &&
					String((m.params as { output: string }).output).includes("started"),
			);
			const began = Date.now();
			child.stdin!.end();
			const answer = await waitFor((m) => m.id === 3);
			expect(Date.now() - began).toBeLessThan(9_000);
			expect(answer.error).toMatchObject({ code: "shuttingDown", data: { worktree: expect.any(String) } });
			expect(await exited).toBe(0);
		} finally {
			child.kill();
			rmSync(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
			rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
	},
	60_000,
);
