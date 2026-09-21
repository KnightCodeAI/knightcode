// scripts/check-lockfile-commit.ts — run by the husky pre-commit hook.
//
// A staged bun.lock that resolves a different set of external packages is a
// dependency change and gets reviewed as code (see "Dependency and Install
// Security" in AGENTS.md). Refuse it unless KNIGHTCODE_ALLOW_LOCKFILE_CHANGE is
// set. Changes confined to workspace metadata (a workspace's own version,
// dependency ranges, bin) resolve nothing new and pass.
import { execFileSync } from "node:child_process";

type Lockfile = Record<string, unknown> & {
	packages?: Record<string, unknown[]>;
};

interface PackageChange {
	key: string;
	before?: unknown[];
	after?: unknown[];
}

const allowValue = process.env.KNIGHTCODE_ALLOW_LOCKFILE_CHANGE;
const allowed = allowValue === "1" || allowValue === "true" || allowValue === "yes";

function git(args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// bun.lock is JSON with trailing commas; nothing in it can contain `,}` or `,]` inside a string.
function readLockfileFromGit(ref: string): Lockfile | undefined {
	try {
		return JSON.parse(git(["show", ref]).replace(/,(\s*[}\]])/g, "$1")) as Lockfile;
	} catch {
		return undefined;
	}
}

// A workspace package's entry is `["@knightcode/ai@workspace:packages/ai"]`.
function isWorkspaceEntry(entry: unknown[] | undefined): boolean {
	return typeof entry?.[0] === "string" && entry[0].includes("@workspace:");
}

// Returns undefined when either side cannot be read, which is treated as an external change.
function getExternalChanges(): { external: string[]; packages: PackageChange[] } | undefined {
	const before = readLockfileFromGit("HEAD:bun.lock");
	const after = readLockfileFromGit(":bun.lock");
	if (!before || !after) return undefined;

	const external: string[] = [];
	const packages: PackageChange[] = [];
	const topKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const topKey of topKeys) {
		if (topKey === "workspaces" || topKey === "packages") continue;
		if (JSON.stringify(before[topKey]) !== JSON.stringify(after[topKey])) external.push(topKey);
	}

	const beforePackages = before.packages ?? {};
	const afterPackages = after.packages ?? {};
	const keys = new Set([...Object.keys(beforePackages), ...Object.keys(afterPackages)]);
	for (const key of [...keys].sort()) {
		const oldEntry = beforePackages[key];
		const newEntry = afterPackages[key];
		if (JSON.stringify(oldEntry) === JSON.stringify(newEntry)) continue;
		if (isWorkspaceEntry(oldEntry ?? newEntry) && isWorkspaceEntry(newEntry ?? oldEntry)) continue;
		packages.push({ key, before: oldEntry, after: newEntry });
	}
	return { external, packages };
}

// The first element of an entry is its resolution, `name@version`.
function versionOf(entry: unknown[] | undefined): string {
	const resolution = typeof entry?.[0] === "string" ? entry[0] : "";
	const at = resolution.lastIndexOf("@");
	return at > 0 ? resolution.slice(at + 1) : "<none>";
}

function summarize(changes: PackageChange[]): string[] {
	return changes.map(({ key, before, after }) => {
		if (!before) return `added ${key}@${versionOf(after)}`;
		if (!after) return `removed ${key}@${versionOf(before)}`;
		const oldVersion = versionOf(before);
		const newVersion = versionOf(after);
		return oldVersion === newVersion ? `changed ${key}@${newVersion}` : `changed ${key} ${oldVersion} -> ${newVersion}`;
	});
}

const stagedFiles = git(["diff", "--cached", "--name-only"])
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);

if (!stagedFiles.includes("bun.lock")) {
	process.exit(0);
}

if (allowed) {
	console.error("bun.lock is staged; KNIGHTCODE_ALLOW_LOCKFILE_CHANGE is set, allowing commit.");
	process.exit(0);
}

const changes = getExternalChanges();
if (changes && changes.external.length === 0 && changes.packages.length === 0) {
	console.error("bun.lock only updates workspace package metadata; allowing commit.");
	process.exit(0);
}

console.error("bun.lock is staged.");
console.error("");
console.error("Review lockfile changes before committing:");
console.error("  - confirm every new/updated package is intentional");
console.error("  - confirm direct external deps stay pinned to exact versions");
console.error("  - review any new lifecycle scripts in the dependency tree");

const summary = [
	...(changes?.external.map((key) => `changed top-level "${key}"`) ?? []),
	...summarize(changes?.packages ?? []),
];
if (summary.length > 0) {
	console.error("");
	console.error("Detected package changes:");
	for (const change of summary.slice(0, 40)) {
		console.error(`  - ${change}`);
	}
	if (summary.length > 40) {
		console.error(`  ... ${summary.length - 40} more`);
	}
}

console.error("");
console.error("If this lockfile change is intentional, commit with:");
console.error("  KNIGHTCODE_ALLOW_LOCKFILE_CHANGE=1 git commit ...");
process.exit(1);
