// scripts/build.ts — run with `bun run scripts/build.ts [--single]`
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../packages/cli/package.json";
import { readMigrationsFromDisk } from "../packages/cli/src/lib/store/migrations";

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "packages/cli/src/index.tsx");

type Target = { os: string; arch: string; bunTarget: Bun.Build.CompileTarget };

const ALL_TARGETS: Target[] = [
  { os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { os: "win32", arch: "x64", bunTarget: "bun-windows-x64" },
];

const single = process.argv.includes("--single");
const targetFlag = process.argv
  .find((a) => a.startsWith("--target="))
  ?.slice("--target=".length);

let targets: Target[];
if (targetFlag) {
  // Explicit single target — used by the CI build matrix (one binary per runner,
  // plus linux-arm64 cross-compiled from the x64 runner).
  const found = ALL_TARGETS.find((t) => `${t.os}-${t.arch}` === targetFlag);
  if (!found) {
    const known = ALL_TARGETS.map((t) => `${t.os}-${t.arch}`).join(", ");
    console.error(`Unknown --target "${targetFlag}". Known: ${known}`);
    process.exit(1);
  }
  targets = [found];
} else if (single) {
  targets = ALL_TARGETS.filter(
    (t) => t.os === process.platform && t.arch === process.arch,
  );
} else {
  targets = ALL_TARGETS;
}

if (targets.length === 0) {
  console.error(`No build target for ${process.platform}-${process.arch}`);
  process.exit(1);
}

const version = (pkg as { version?: string }).version ?? "0.0.0-dev";
const migrations = readMigrationsFromDisk();
if (migrations.length === 0) {
  console.error(
    "No migrations found to embed — refusing to build a binary with an empty migration set.",
  );
  process.exit(1);
}
console.log(`Embedding ${migrations.length} migration(s), version ${version}`);

for (const target of targets) {
  const outDir = join(ROOT, "packages", `cli-${target.os}-${target.arch}`, "bin");
  mkdirSync(outDir, { recursive: true });
  const binName = target.os === "win32" ? "knightcode.exe" : "knightcode";
  const outfile = join(outDir, binName);

  console.log(`Building ${target.os}-${target.arch} → ${outfile}`);
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    compile: { target: target.bunTarget, outfile },
    define: {
      KNIGHTCODE_VERSION: JSON.stringify(version),
      KNIGHTCODE_MIGRATIONS: JSON.stringify(migrations),
    },
  });

  if (!result.success) {
    console.error(`Build failed for ${target.os}-${target.arch}`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  // Compiled binaries must be executable on POSIX (npm preserves the mode bit).
  if (target.os !== "win32") chmodSync(outfile, 0o755);
}

console.log("Build complete.");
