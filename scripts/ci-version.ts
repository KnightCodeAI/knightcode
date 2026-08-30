// scripts/ci-version.ts — run with `bun run ci:version`.
//
// Invoked by changesets/action in .github/workflows/publish.yml to produce the
// "chore(release): version packages" PR. Wraps `changeset version` with the
// lockstep guarantee pi enforces in scripts/sync-versions.js: the six
// @knightcodeai/cli* packages are a `fixed` group in .changeset/config.json, so
// they must always come out of a version bump at the identical version, and the
// main package's optionalDependencies must pin exactly that version. If either
// drifts, `npm install @knightcodeai/cli` resolves a platform package that was
// never published and the launcher has no binary to exec.
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// Keep in sync with the `fixed` group in .changeset/config.json and the
// registry check in .github/workflows/publish.yml.
const MAIN = "@knightcodeai/cli";
const PLATFORM_TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

type Manifest = { name: string; version: string; optionalDependencies?: Record<string, string> };

function manifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
}

await $`bun x changeset version`.cwd(ROOT);

// changesets rewrites package.json files; re-read from disk, never from an
// import cache that predates the bump.
const cli = manifest("cli");
const platforms = PLATFORM_TARGETS.map((target) => manifest(`cli-${target}`));

const versions = new Set([cli.version, ...platforms.map((p) => p.version)]);
if (versions.size !== 1) {
  const listed = [cli, ...platforms].map((p) => `  ${p.name}: ${p.version}`).join("\n");
  throw new Error(
    `Fixed-group packages are not lockstep after \`changeset version\`:\n${listed}\n` +
      `Check the \`fixed\` array in .changeset/config.json.`,
  );
}

const optional = cli.optionalDependencies ?? {};
const mismatched = platforms
  .filter((p) => optional[p.name] !== cli.version)
  .map((p) => `  ${p.name}: pinned ${optional[p.name] ?? "(absent)"}, expected ${cli.version}`);
if (mismatched.length > 0) {
  throw new Error(
    `${MAIN} optionalDependencies do not pin the release version:\n${mismatched.join("\n")}\n` +
      `Publishing this would ship a launcher whose platform package does not exist on npm.`,
  );
}

// Record the workspace version bumps in the lockfile so the Version PR is
// installable as-is.
await $`bun install --lockfile-only`.cwd(ROOT);

console.log(`Versioned ${MAIN} and ${platforms.length} platform packages at ${cli.version}`);
