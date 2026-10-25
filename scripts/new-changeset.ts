// scripts/new-changeset.ts — run with `bun run changeset [category] [bump] [cli|desktop]`.
//
// `bun x changeset` walks an interactive package picker, and a change here
// releases the CLI, the desktop app, or both (one changeset each). So scaffold
// the file directly instead, named after the current branch, with the category
// verb already in place — see CONTRIBUTING.md for why the first word of the
// summary matters.
//
// The template is inlined rather than kept as `.changeset/TEMPLATE.md`, because
// @changesets/read parses every non-dotted `.changeset/*.md` except README.md:
// a template file would ship as a changelog entry on the next release.
import { $ } from "bun";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES } from "./changelog-sections.ts";

const ROOT = join(import.meta.dir, "..");
const BUMPS = ["patch", "minor", "major"];
// The CLI on npm (the app server and the terminal), and the desktop app, which
// changesets versions and desktop-release.yml ships. Anything else is rare
// enough for `bun x changeset`.
const PACKAGES: Record<string, string> = { cli: "@knightcodeai/cli", desktop: "@knightcode/desktop" };

const [categoryArg, bumpArg, packageArg] = Bun.argv.slice(2);

const category = CATEGORIES.find((c) => c.toLowerCase() === (categoryArg ?? "fixed").toLowerCase());
if (!category) {
	throw new Error(`Unknown category "${categoryArg}". Use one of: ${CATEGORIES.join(", ")}`);
}

const bump = bumpArg ?? "patch";
if (!BUMPS.includes(bump)) {
	throw new Error(`Unknown bump "${bump}". Use one of: ${BUMPS.join(", ")}`);
}

// Own keys only: `toString` or `__proto__` would otherwise name an inherited value.
const packageKey = packageArg ?? "cli";
const PACKAGE = Object.hasOwn(PACKAGES, packageKey) ? PACKAGES[packageKey] : undefined;
if (!PACKAGE) {
	throw new Error(`Unknown package "${packageArg}". Use one of: ${Object.keys(PACKAGES).join(", ")}`);
}

// A changeset is named for the change, so the branch name is already the right
// slug — minus its type prefix, which the category now carries.
const branch = (await $`git branch --show-current`.cwd(ROOT).text()).trim();
const slug = branch
	.replace(/^(feat|fix|chore|docs|refactor|perf|test|ci|style)\//, "")
	.replace(/[^a-zA-Z0-9]+/g, "-")
	.replace(/^-|-$/g, "")
	.toLowerCase();
// `main` is checked before the prefix strip, so a branch named `feat/main` is
// still fine; an empty slug means a detached HEAD or an all-punctuation name.
if (branch === "main" || slug === "") {
	throw new Error(`Branch "${branch}" gives no usable changeset name — branch before writing one.`);
}

// A branch carrying two user-visible changes needs two changesets — see
// CONTRIBUTING.md — so take the next free suffix rather than refuse the second.
let name = slug;
for (let n = 2; existsSync(join(ROOT, ".changeset", `${name}.md`)); n++) name = `${slug}-${n}`;
const path = join(ROOT, ".changeset", `${name}.md`);

writeFileSync(
	path,
	`---
"${PACKAGE}": ${bump}
---

${category} `,
);

console.log(`.changeset/${name}.md

Finish the sentence after "${category}" — it becomes the changelog entry verbatim,
under a "### ${category}" heading. Commit it with your PR.`);
