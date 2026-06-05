// scripts/build.ts — run with `bun run scripts/build.ts [--single]`
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../packages/cli/package.json";
import { readMigrationsFromDisk } from "../packages/cli/src/lib/store/migrations";

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "packages/cli/src/index.tsx");

type Target = { os: string; arch: string; bunTarget: string };

const ALL_TARGETS: Target[] = [
  { os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { os: "win32", arch: "x64", bunTarget: "bun-windows-x64" },
];

const single = process.argv.includes("--single");
const targets = single
  ? ALL_TARGETS.filter(
      (t) => t.os === process.platform && t.arch === process.arch,
    )
  : ALL_TARGETS;

if (targets.length === 0) {
  console.error(`No build target for ${process.platform}-${process.arch}`);
  process.exit(1);
}

// package.json has no typed `version` field yet (added in Plan B) — read defensively.
const version = (pkg as { version?: string }).version ?? "0.0.0-dev";
const migrations = readMigrationsFromDisk();
console.log(`Embedding ${migrations.length} migration(s), version ${version}`);

for (const target of targets) {
  const outDir = join(ROOT, "dist", `${target.os}-${target.arch}`);
  mkdirSync(outDir, { recursive: true });
  const binName = target.os === "win32" ? "knightcode.exe" : "knightcode";
  const outfile = join(outDir, binName);

  console.log(`Building ${target.os}-${target.arch} → ${outfile}`);
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    // Bun validates the platform triple at build time; the static union type is
    // narrower than our runtime list, so cast.
    compile: { target: target.bunTarget as never, outfile },
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
}

console.log("Build complete.");
