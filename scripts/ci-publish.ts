// scripts/ci-publish.ts — run with `bun run ci:publish`.
//
// Invoked by the publish job in .github/workflows/publish.yml after
// `bun run build:cli` has written the Node bundle to packages/cli/dist/:
//
//   1. assert the bundle is there, that the manifest depends on no `workspace:`
//      package, and that it carries the repository field npm provenance requires
//   2. validate the real install path end-to-end (scripts/pack-test.ts)
//   3. validate the tarball with `npm pack --dry-run`
//   4. skip the publish if the version is already on npm, publish with provenance
//   5. tag the release and push it
//
// Step 4 is what makes a failed run safe to re-run.
import { $ } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const DIR = join(ROOT, "packages", "cli");

const manifest = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8")) as {
	name: string;
	version: string;
	bin: Record<string, string>;
	repository?: string | { url?: string };
} & Record<string, unknown>;
const { name, version } = manifest;
console.log(`Publishing ${name}@${version}${DRY_RUN ? " (dry run)" : ""}\n`);

// 1. the bundle the bin entry points at
for (const entry of Object.values(manifest.bin)) {
	if (!existsSync(join(DIR, entry))) {
		throw new Error(`${name} has no ${entry}. Run \`bun run build:cli\` before publishing.`);
	}
}

// 1b. nothing in the published manifest may reference a workspace package.
// `npm pack` does NOT rewrite `workspace:*` — it copies the spec verbatim — so a
// dependency on an unpublished workspace package makes the tarball uninstallable
// with EUNSUPPORTEDPROTOCOL. The bundle inlines the workspace; build-time
// packages belong in devDependencies, which npm does not install for consumers.
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
	for (const [dep, spec] of Object.entries((manifest[field] as Record<string, string> | undefined) ?? {})) {
		if (spec.startsWith("workspace:")) {
			throw new Error(
				`${name} declares ${field}["${dep}"] = "${spec}". npm publishes that spec ` +
					`verbatim, so \`npm install ${name}\` fails with EUNSUPPORTEDPROTOCOL. ` +
					`Move it to devDependencies.`,
			);
		}
	}
}

// 1c. `npm publish --provenance` refuses (E422) a manifest whose repository.url
// does not match the building repo, and it only finds out after signing and
// uploading. Check it up front.
const expectedRepo = process.env.GITHUB_REPOSITORY;
const url = typeof manifest.repository === "string" ? manifest.repository : (manifest.repository?.url ?? "");
const slug = url
	.replace(/^git\+/, "")
	.replace(/\.git$/, "")
	.replace(/^https:\/\/github\.com\//, "");
if (!slug || (expectedRepo && slug !== expectedRepo)) {
	throw new Error(
		`${name} has repository.url "${url}"` +
			`${expectedRepo ? `, which does not resolve to ${expectedRepo}` : " (empty)"}. ` +
			`npm rejects the provenance attestation without a matching repository field.`,
	);
}

// 2. the real install path
console.log("Validating the npm install path (pack-test)...");
await $`bun run ${join(ROOT, "scripts", "pack-test.ts")}`.cwd(ROOT);
console.log();

async function isPublished(): Promise<boolean> {
	const result = await $`npm view ${`${name}@${version}`} version --json`.nothrow().quiet();
	if (result.exitCode === 0 && result.stdout.toString().trim()) return true;
	const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
	if (output.includes("E404") || output.includes("404 Not Found")) return false;
	throw new Error(`Failed to query ${name}@${version}\n${output.trim()}`);
}

// 3 + 4. validate, then publish if missing
const published = await isPublished();
console.log(
	published
		? `${name}@${version} is already published; validating contents only.`
		: `${name}@${version} is not published; validating contents before publish.`,
);
const packed = JSON.parse(await $`npm pack --dry-run --ignore-scripts --json`.cwd(DIR).quiet().text())[0];
console.log(
	`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked\n`,
);

if (DRY_RUN) {
	console.log("Dry run: validated the package, published nothing.");
	process.exit(0);
}

if (published) {
	console.log(`${name}@${version} was already on npm; nothing to tag.`);
	process.exit(0);
}
// --provenance needs `id-token: write` on the job; --ignore-scripts keeps a
// compromised transitive dependency from running code at publish time.
await $`npm publish --access public --provenance --ignore-scripts`.cwd(DIR);
console.log();

// 5. tag the released commit. changesets/action owns the Version PR, not the
// tag, so the tag is created here against the merged commit that was published.
const tag = `v${version}`;
const exists = await $`git rev-parse --verify --quiet ${`refs/tags/${tag}`}`.nothrow().quiet();
if (exists.exitCode === 0) {
	console.log(`Tag ${tag} already exists; leaving it alone.`);
} else {
	await $`git tag ${tag}`.cwd(ROOT);
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY;
	if (token && repo) {
		await $`git push https://x-access-token:${token}@github.com/${repo}.git ${tag}`.cwd(ROOT).quiet();
	} else {
		await $`git push origin ${tag}`.cwd(ROOT);
	}
	console.log(`Pushed ${tag}`);
}

console.log(`\nPublished KnightCode ${version}`);
