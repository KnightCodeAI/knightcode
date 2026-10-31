/**
 * Plugin and marketplace sources as users write them: `owner/repo`, a Git URL, a local path, or (plugins only)
 * `name@marketplace`. Parsing never touches the network, so a session can map declarations to installs offline.
 */

import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseGitUrl } from "../utils/git.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";

export type ParsedSource =
	| { kind: "local"; dir: string; canonical: string }
	| { kind: "git"; url: string; canonical: string; ref?: string }
	| { kind: "marketplace"; plugin: string; marketplace: string };

const CATALOG_REF = /^([A-Za-z0-9][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const GITHUB_SHORTHAND = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;

export function forwardSlashes(path: string): string {
	return path.replace(/\\/g, "/");
}

/** `text` without trailing `char`s. A loop, because `/c+$/` is quadratic on a long run of `c` that is not at the end. */
export function trimTrailing(text: string, char: string): string {
	let end = text.length;
	while (end > 0 && text[end - 1] === char) end--;
	return text.slice(0, end);
}

/** `https://host/owner/repo`: lowercase host, no `.git`, no trailing slash. */
export function canonicalUrl(url: string): string {
	const trimmed = trimTrailing(url, "/").replace(/\.git$/, "");
	try {
		const parsed = new URL(trimmed);
		parsed.hostname = parsed.hostname.toLowerCase();
		parsed.username = "";
		parsed.password = "";
		return trimTrailing(parsed.toString(), "/");
	} catch {
		return trimmed;
	}
}

/** `https://host[:port]/owner/repo` for any transport; GitHub ignores case in repository paths, so it is dropped. */
function hostCanonical(host: string, path: string, port = ""): string {
	const lower = host.toLowerCase();
	const repo = trimTrailing(path, "/").replace(/\.git$/, "");
	return `https://${lower}${port ? `:${port}` : ""}/${lower === "github.com" ? repo.toLowerCase() : repo}`;
}

function looksLocal(source: string, baseDir: string): boolean {
	return (
		source.startsWith(".") ||
		source.startsWith("~") ||
		isAbsolute(source) ||
		/^[A-Za-z]:[\\/]/.test(source) ||
		(!GITHUB_SHORTHAND.test(source) && existsSync(resolvePath(source, baseDir)))
	);
}

/** Parses `source`; relative local paths resolve against `baseDir`. */
export function parseSource(source: string, baseDir: string): ParsedSource | { error: string } {
	const trimmed = source.trim();
	if (!trimmed) return { error: "source is empty" };
	const catalog = trimmed.match(CATALOG_REF);
	if (catalog) return { kind: "marketplace", plugin: catalog[1]!, marketplace: catalog[2]! };
	if (/^file:\/\//i.test(trimmed)) return { kind: "git", url: trimmed, canonical: canonicalUrl(trimmed) };
	if (looksLocal(trimmed, baseDir)) {
		const dir = resolvePath(trimmed, baseDir);
		return { kind: "local", dir, canonical: `local:${forwardSlashes(canonicalizePath(dir))}` };
	}
	const git = parseGitUrl(trimmed) ?? (/^git@/.test(trimmed) ? parseGitUrl(`git:${trimmed}`) : null);
	if (git) {
		return {
			kind: "git",
			url: git.repo,
			canonical:
				git.host && git.path
					? hostCanonical(git.host, git.path, URL.canParse(git.repo) ? new URL(git.repo).port : "")
					: canonicalUrl(git.repo),
			...(git.ref ? { ref: git.ref } : {}),
		};
	}
	if (/^(https?|ssh|git):\/\//i.test(trimmed)) return { kind: "git", url: trimmed, canonical: canonicalUrl(trimmed) };
	const shorthand = trimmed.match(/^([A-Za-z0-9][\w.-]*\/[\w.-]+?)(?:\.git)?(?:@([^\s@]+))?$/);
	if (shorthand) {
		const repo = shorthand[1]!;
		return {
			kind: "git",
			url: `https://github.com/${repo}.git`,
			canonical: hostCanonical("github.com", repo),
			...(shorthand[2] ? { ref: shorthand[2] } : {}),
		};
	}
	return { error: `unrecognized source "${source}": use owner/repo, a Git URL, a local path, or name@marketplace` };
}

/** The identity of a plugin: its canonical source, subdirectory, and catalog entry. */
export function pluginIdentity(canonical: string, path: string | undefined, catalogEntry?: string): string {
	const subdir = path ? trimTrailing(forwardSlashes(path).replace(/^\.\//, ""), "/") : "";
	return `${canonical}${subdir && subdir !== "." ? `#path=${subdir}` : ""}${catalogEntry ? `#plugin=${catalogEntry}` : ""}`;
}
