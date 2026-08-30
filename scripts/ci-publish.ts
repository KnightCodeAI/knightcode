// scripts/ci-publish.ts — run with `bun run ci:publish`.
//
// Invoked by the publish job in .github/workflows/publish.yml after the build
// matrix has compiled and smoke-tested every binary and restored them into
// packages/cli-<target>/bin/. Direct port of pi's scripts/publish.mjs
// semantics, adapted from npm workspaces to this repo's layout:
//
//   1. assert the publish set is lockstep-versioned
//   2. assert every platform package actually carries its binary, and that no
//      published manifest depends on a `workspace:` package
//   3. validate the real install path end-to-end (scripts/pack-test.ts)
//   4. validate each tarball with `npm pack --dry-run`
//   5. skip anything already on npm, publish the rest with provenance
//   6. tag the release and push it
//
// Steps 1, 2 and 5 are what make a partially-failed run safe to re-run: npm
// publishes are not transactional across six packages, so a network failure
// after the third publish must be recoverable by re-running this script.
import { $ } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DRY_RUN = process.argv.includes("--dry-run");

const PLATFORM_TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

type Entry = { name: string; version: string; dir: string; binary?: string };

function manifest(dir: string): { name: string; version: string } {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

function entry(packageDir: string, binary?: string): Entry {
	const dir = join(ROOT, "packages", packageDir);
	const { name, version } = manifest(dir);
	return { name, version, dir, binary: binary ? join(dir, "bin", binary) : undefined };
}

// Platform packages first: the launcher is useless without them, so if the run
// dies partway the main package is the one left unpublished, not the reverse.
const packages: Entry[] = [
	...PLATFORM_TARGETS.map((target) => entry(`cli-${target}`, target === "win32-x64" ? "knightcode.exe" : "knightcode")),
	entry("cli"),
];

// 1. lockstep
const versions = [...new Set(packages.map((p) => p.version))];
if (versions.length !== 1) {
	const listed = packages.map((p) => `  ${p.name}: ${p.version}`).join("\n");
	throw new Error(`Publish set is not lockstep versioned:\n${listed}`);
}
const version = versions[0];
console.log(`Publishing KnightCode packages at ${version}${DRY_RUN ? " (dry run)" : ""}\n`);

// 2. every platform package carries its binary
for (const pkg of packages) {
	if (!pkg.binary) continue;
	if (!existsSync(pkg.binary)) {
		throw new Error(
			`${pkg.name} has no binary at ${pkg.binary}. The build matrix must run and its ` +
				`artifacts be restored before publishing.`,
		);
	}
}

// 2b. nothing in a published manifest may reference a workspace package.
// `npm pack` does NOT rewrite `workspace:*` — it copies the spec verbatim — so a
// dependency on an unpublished workspace package makes the tarball uninstallable
// with EUNSUPPORTEDPROTOCOL. Everything the CLI needs is compiled into the
// platform binary; build-time packages belong in devDependencies, which npm does
// not install for consumers.
for (const pkg of packages) {
	const raw = JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8")) as Record<
		string,
		Record<string, string> | undefined
	>;
	for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
		for (const [dep, spec] of Object.entries(raw[field] ?? {})) {
			if (typeof spec === "string" && spec.startsWith("workspace:")) {
				throw new Error(
					`${pkg.name} declares ${field}["${dep}"] = "${spec}". npm publishes that spec ` +
						`verbatim, so \`npm install ${pkg.name}\` fails with EUNSUPPORTEDPROTOCOL. ` +
						`Move it to devDependencies.`,
				);
			}
		}
	}
}

// 3. the real install path
console.log("Validating the npm install path (pack-test)...");
await $`bun run ${join(ROOT, "scripts", "pack-test.ts")}`.cwd(ROOT);
console.log();

async function isPublished(name: string, wanted: string): Promise<boolean> {
	const result = await $`npm view ${`${name}@${wanted}`} version --json`.nothrow().quiet();
	if (result.exitCode === 0 && result.stdout.toString().trim()) return true;
	const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
	if (output.includes("E404") || output.includes("404 Not Found")) return false;
	throw new Error(`Failed to query ${name}@${wanted}\n${output.trim()}`);
}

// 4 + 5. validate, then publish what is missing
const states: { pkg: Entry; published: boolean }[] = [];
for (const pkg of packages) {
	const published = await isPublished(pkg.name, pkg.version);
	console.log(
		published
			? `${pkg.name}@${pkg.version} is already published; validating contents only.`
			: `${pkg.name}@${pkg.version} is not published; validating contents before publish.`,
	);
	const packed = JSON.parse(await $`npm pack --dry-run --ignore-scripts --json`.cwd(pkg.dir).quiet().text())[0];
	console.log(
		`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`,
	);
	states.push({ pkg, published });
}
console.log();

if (DRY_RUN) {
	console.log("Dry run: validated every package, published nothing.");
	process.exit(0);
}

let publishedAny = false;
for (const { pkg, published } of states) {
	if (published) {
		console.log(`Skipping ${pkg.name}@${pkg.version}: already published\n`);
		continue;
	}
	// --provenance needs `id-token: write` on the job; --ignore-scripts keeps a
	// compromised transitive dependency from running code at publish time.
	await $`npm publish --access public --provenance --ignore-scripts`.cwd(pkg.dir);
	publishedAny = true;
	console.log();
}

if (!publishedAny) {
	console.log(`Every package at ${version} was already on npm; nothing to tag.`);
	process.exit(0);
}

// 6. tag the released commit. changesets/action owns the Version PR, not the
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
