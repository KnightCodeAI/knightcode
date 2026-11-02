// From GitHub (spec section 18): previews the skills in a repository (every SKILL.md, read over HTTPS through the
// guarded fetch, no git) before the user adds the ones they pick. A repository without skills is refused.
import type { SkillDraft } from "@knightcode/bots-protocol";
import { type FetchPolicy, guardedFetch } from "../connectors/guarded-fetch.ts";

const MAX_SKILLS = 50;
const MAX_FILE_BYTES = 100_000;

export class NoSkills extends Error {
	constructor() {
		super("This repository has no skills (no SKILL.md files).");
		this.name = "NoSkills";
	}
}

/** owner, repo, ref and folder from a github.com URL. */
export function parseGitHubUrl(url: string): { owner: string; repo: string; ref?: string; path: string } {
	const parsed = new URL(url);
	if (parsed.hostname !== "github.com") throw new Error("Use a github.com repository link.");
	const [owner, repo, kind, ref, ...rest] = parsed.pathname.replace(/^\/|\/$/g, "").split("/");
	if (!owner || !repo) throw new Error("Use a github.com repository link.");
	return { owner, repo: repo.replace(/\.git$/, ""), ...(kind === "tree" && ref ? { ref } : {}), path: kind === "tree" ? rest.join("/") : "" };
}

/** name and description from a SKILL.md's frontmatter, and its body. */
export function parseSkillFile(text: string, fallbackName: string): SkillDraft {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	const fields: Record<string, string> = {};
	for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
		const field = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
		if (field) fields[field[1]!.toLowerCase()] = field[2]!.trim().replace(/^["']|["']$/g, "");
	}
	return {
		name: fields.name || fallbackName,
		description: (fields.description ?? "").replace(/\s+/g, " ").slice(0, 300),
		content: (match ? match[2]! : text).trim(),
	};
}

type Fetch = (url: string) => Promise<Response>;

/** The repository's skills, for the preview; throws `NoSkills` when it has none. */
export async function importFromGitHub(url: string, fetcher?: Fetch, policy: FetchPolicy = { allowPrivate: [] }): Promise<SkillDraft[]> {
	const get: Fetch = fetcher ?? ((target) => guardedFetch(target, { headers: { "user-agent": "knightcode-bots" } }, policy));
	const { owner, repo, ref, path } = parseGitHubUrl(url);
	const branch =
		ref ??
		((await (await get(`https://api.github.com/repos/${owner}/${repo}`)).json()) as { default_branch?: string }).default_branch ??
		"main";
	const tree = (await (await get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`)).json()) as {
		tree?: { path: string; type: string; size?: number }[];
	};
	const files = (tree.tree ?? [])
		.filter((item) => item.type === "blob" && /(^|\/)SKILL\.md$/i.test(item.path) && (!path || item.path.startsWith(`${path}/`)))
		.filter((item) => (item.size ?? 0) <= MAX_FILE_BYTES)
		.slice(0, MAX_SKILLS);
	if (files.length === 0) throw new NoSkills();
	const drafts: SkillDraft[] = [];
	for (const file of files) {
		const response = await get(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file.path}`);
		if (!response.ok) continue;
		const folder = file.path.split("/").slice(-2, -1)[0] ?? repo;
		drafts.push(parseSkillFile(await response.text(), folder));
	}
	if (drafts.length === 0) throw new NoSkills();
	return drafts;
}
