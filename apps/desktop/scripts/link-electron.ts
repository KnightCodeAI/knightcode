/**
 * Forge finds `electron` in this package's node_modules or beside an npm/yarn/pnpm lockfile, never
 * beside bun.lock, and the workspace hoists it to the root. Link it where Forge looks.
 * ponytail: drop once Forge's electron lookup understands bun.lock.
 *
 * node-pty 1.1.0 publishes its macOS spawn-helper without the execute bit, so every terminal fails with
 * "posix_spawnp failed"; set it here, before start, package and make, and the package copies the mode.
 */

import { chmodSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const link = join(import.meta.dirname, "..", "node_modules", "electron");
const target = join(import.meta.dirname, "..", "..", "..", "node_modules", "electron");
if (!existsSync(link) && existsSync(target)) {
	mkdirSync(dirname(link), { recursive: true });
	symlinkSync(target, link, "junction");
}

const pty = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
for (const arch of ["arm64", "x64"]) {
	const helper = join(pty, "prebuilds", `darwin-${arch}`, "spawn-helper");
	if (existsSync(helper)) chmodSync(helper, 0o755);
}
