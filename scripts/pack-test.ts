// scripts/pack-test.ts — validate the published install end-to-end, locally.
// Packs the main package + the current-platform package via real `npm pack`,
// installs both tarballs into a throwaway project, and runs the launcher.
import { $ } from "bun";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../packages/cli/package.json";

const ROOT = join(import.meta.dir, "..");
const platform = process.platform;
const arch = process.arch;
const expectedVersion = pkg.version;

const mainDir = join(ROOT, "packages", "cli");
const platformDir = join(ROOT, "packages", `cli-${platform}-${arch}`);
const binName = platform === "win32" ? "knightcode.exe" : "knightcode";
const binPath = join(platformDir, "bin", binName);

if (!existsSync(platformDir)) {
  console.error(`No platform package for ${platform}-${arch} (${platformDir})`);
  process.exit(1);
}

// Ensure the current-platform binary exists; build it if missing.
if (!existsSync(binPath)) {
  console.log("Binary missing — building current platform...");
  await $`bun run ${join(ROOT, "scripts", "build.ts")} --single`.cwd(ROOT);
}

const work = mkdtempSync(join(tmpdir(), "kc-packtest-"));
const proj = join(work, "proj");
await $`mkdir -p ${proj}`.nothrow();

try {
  // Pack both packages into the temp dir (npm prints the tarball filename).
  const mainTgz = (
    await $`npm pack --silent --pack-destination ${work}`.cwd(mainDir).text()
  ).trim();
  const platformTgz = (
    await $`npm pack --silent --pack-destination ${work}`.cwd(platformDir).text()
  ).trim();

  await $`npm init -y`.cwd(proj);
  // Install both local tarballs together so the optionalDependency is satisfied
  // locally (the registry has nothing yet).
  await $`npm install --no-audit --no-fund ${join(work, mainTgz)} ${join(work, platformTgz)}`.cwd(
    proj,
  );

  const launcher = join(
    proj,
    "node_modules",
    "@knightcodeai",
    "cli",
    "bin",
    "knightcode",
  );

  // --version must print exactly the package version.
  const version = (await $`node ${launcher} --version`.cwd(proj).text()).trim();
  if (version !== expectedVersion) {
    throw new Error(
      `--version mismatch: got "${version}", expected "${expectedVersion}"`,
    );
  }
  console.log(`✓ --version → ${version}`);

  // doctor must exit 0.
  const doctor = await $`node ${launcher} doctor`.cwd(proj).nothrow();
  if (doctor.exitCode !== 0) {
    throw new Error(`doctor exited ${doctor.exitCode}`);
  }
  console.log("✓ doctor exit 0");

  console.log(`pack-test passed for ${platform}-${arch}`);
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // Windows may hold a handle on the temp sqlite db — OS reaps it.
  }
}
