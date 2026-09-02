// scripts/new-changeset.ts — run with `bun run changeset [category] [bump]`.
//
// `bun x changeset` walks an interactive package picker, and every changeset in
// this repo's history has picked the same single package. So scaffold the file
// directly instead, named after the current branch, with the category verb
// already in place — see CONTRIBUTING.md for why the first word of the summary
// matters.
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
// Every changeset in this repo's history releases exactly this package; reach
// for `bun x changeset` on the rare change that needs a different one.
const PACKAGE = "@knightcodeai/cli";

const [categoryArg, bumpArg] = Bun.argv.slice(2);

const category = CATEGORIES.find((c) => c.toLowerCase() === (categoryArg ?? "fixed").toLowerCase());
if (!category) {
	throw new Error(`Unknown category "${categoryArg}". Use one of: ${CATEGORIES.join(", ")}`);
}

const bump = bumpArg ?? "patch";
if (!BUMPS.includes(bump)) {
	throw new Error(`Unknown bump "${bump}". Use one of: ${BUMPS.join(", ")}`);
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
