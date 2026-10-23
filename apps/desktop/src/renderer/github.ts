/** "Open in GitHub" (Codex's lZa): the link to a checkout's file on github.com at its branch and line. */

import type { ResultOf } from "@knightcode/app-server-protocol";

/** Owner and repository of a github.com remote: https, ssh:// or scp-like (git@github.com:owner/repo.git). */
export function githubRepo(url: string): { owner: string; repo: string } | undefined {
	const match =
		/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url) ??
		/^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
	if (!match || match[1]!.toLowerCase() !== "github.com") return undefined;
	return { owner: match[2]!, repo: match[3]! };
}

const slashes = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

/**
 * The file on GitHub at the checkout's branch, at its line (Codex's lZa): none without a github.com origin, a branch,
 * or a file inside the checkout. Windows paths compare without case.
 */
export function githubLink(origin: ResultOf<"git/origin">, path: string, line?: number): string | undefined {
	const branch = origin.branch?.trim();
	const repo = origin.url ? githubRepo(origin.url) : undefined;
	if (!repo || !branch) return undefined;
	const root = slashes(origin.root);
	const file = slashes(path);
	const windows = /^[a-zA-Z]:/.test(root) || root.startsWith("//");
	if (!(windows ? file.toLowerCase() : file).startsWith(`${windows ? root.toLowerCase() : root}/`)) return undefined;
	const encode = (value: string) => value.split("/").map(encodeURIComponent).join("/");
	const relative = file.slice(root.length + 1);
	return `https://github.com/${encode(repo.owner)}/${encode(repo.repo)}/blob/${encode(branch)}/${encode(relative)}${line ? `#L${line}` : ""}`;
}
