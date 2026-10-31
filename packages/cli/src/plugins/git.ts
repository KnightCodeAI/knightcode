/**
 * Git for plugin sources, run unattended: before a plugin is trusted, nothing it ships may run.
 *
 * - The working directory is always the plugins directory, never a download: on Windows, cross-spawn resolves a
 *   command in the working directory before PATH, so a repository's own `git.cmd` would run instead of Git.
 *   Repositories are addressed with `-C`.
 * - `core.hooksPath` points at the null device on every call, so a user's relative `core.hooksPath` (such as
 *   `.husky/_`) cannot resolve into the repository and run its checkout hooks.
 * - No prompts (terminal, askpass, SSH, credential manager), no LFS smudge, no submodules, stdin closed, and a
 *   deadline that kills network operations.
 */

import { spawnProcess, waitForChildProcess } from "../utils/child-process.ts";
import { killProcessTree } from "../utils/shell.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const FULL_SHA = /^[0-9a-f]{40}$/i;

export interface GitOptions {
	/** The plugins directory: the working directory of every Git process. */
	cwd: string;
	/** Deadline for network operations. */
	timeoutMs?: number;
}

export class GitError extends Error {
	readonly timedOut: boolean;
	constructor(message: string, timedOut = false) {
		super(message);
		this.timedOut = timedOut;
	}
}

function gitEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "",
		SSH_ASKPASS: "",
		GIT_LFS_SKIP_SMUDGE: "1",
		GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
		GCM_INTERACTIVE: "never",
	};
}

/** Runs `git` with the safety settings above. Rejects with the command's stderr when it fails. */
export async function runGit(args: string[], options: GitOptions & { network?: boolean }): Promise<string> {
	const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
	// core.longpaths lets Git for Windows check out past 260 characters, which deep catalogs such as Anthropic's need;
	// other platforms ignore it.
	const safety = ["-c", `core.hooksPath=${nullDevice}`, "-c", "submodule.recurse=false", "-c", "core.longpaths=true"];
	const child = spawnProcess("git", [...safety, ...args], {
		cwd: options.cwd,
		env: gitEnv(),
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf-8");
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf-8");
	});
	let timedOut = false;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timer = options.network
		? setTimeout(() => {
				timedOut = true;
				// On Windows, Git's transport helper (git-remote-http) outlives a killed git and keeps the checkout open.
				if (process.platform === "win32" && child.pid) killProcessTree(child.pid);
				else child.kill("SIGKILL");
			}, timeoutMs)
		: undefined;
	try {
		const code = await waitForChildProcess(child);
		if (timedOut) throw new GitError(`git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)} s`, true);
		if (code !== 0) throw new GitError(`git ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`);
		return stdout;
	} catch (error) {
		if (error instanceof GitError) throw error;
		throw new GitError(`git could not run: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** Refuses refs Git would read as options. */
export function assertSafeRef(ref: string | undefined): void {
	if (ref !== undefined && (ref.startsWith("-") || !ref.trim() || /\s/.test(ref))) {
		throw new GitError(`invalid ref "${ref}"`);
	}
}

/** The commit `ref` (default: the remote's HEAD) points at, without downloading the repository. */
export async function resolveRemoteCommit(url: string, ref: string | undefined, options: GitOptions): Promise<string> {
	assertSafeRef(ref);
	if (ref && FULL_SHA.test(ref)) return ref.toLowerCase();
	const output = await runGit(["ls-remote", "--", url, ...(ref ? [ref, `${ref}^{}`] : ["HEAD"])], {
		...options,
		network: true,
	});
	const lines = output
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.filter((parts): parts is [string, string] => parts.length === 2);
	if (!ref) {
		const head = lines.find(([, name]) => name === "HEAD");
		if (head) return head[0];
	} else {
		// A peeled tag (`^{}`) names the commit; the plain tag ref names the tag object.
		const exact = [`refs/tags/${ref}^{}`, `refs/heads/${ref}`, `refs/tags/${ref}`, ref];
		for (const name of exact) {
			const match = lines.find(([, candidate]) => candidate === name);
			if (match) return match[0];
		}
	}
	throw new GitError(`${url} has no ref ${ref ?? "HEAD"}`);
}

/**
 * Downloads `commit` of `url` into the new directory `into` (which must not exist) and checks it out, without
 * submodules, LFS content or hooks.
 */
export async function fetchCommit(url: string, commit: string, into: string, options: GitOptions): Promise<void> {
	if (!FULL_SHA.test(commit)) throw new GitError(`not a full commit SHA: ${commit}`);
	await runGit(["init", "--quiet", "--", into], options);
	await runGit(["-C", into, "fetch", "--quiet", "--no-tags", "--depth", "1", "--", url, commit], {
		...options,
		network: true,
	}).catch(async (error: unknown) => {
		// A remote that stalled once gets no second deadline.
		if (error instanceof GitError && error.timedOut) throw error;
		// Servers that refuse unadvertised commits (and local paths) need the full history.
		const refspecs = ["+refs/heads/*:refs/remotes/source/*", "+refs/tags/*:refs/tags/*"];
		await runGit(["-C", into, "fetch", "--quiet", "--", url, ...refspecs], { ...options, network: true }).catch(() => {
			throw error;
		});
	});
	await runGit(["-C", into, "checkout", "--quiet", "--detach", commit], options);
}
