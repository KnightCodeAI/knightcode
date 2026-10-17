/**
 * Forge finds `electron` in this package's node_modules or beside an npm/yarn/pnpm lockfile, never
 * beside bun.lock, and the workspace hoists it to the root. Link it where Forge looks.
 * ponytail: drop once Forge's electron lookup understands bun.lock.
 */

import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const link = join(import.meta.dirname, "..", "node_modules", "electron");
const target = join(import.meta.dirname, "..", "..", "..", "node_modules", "electron");
if (!existsSync(link) && existsSync(target)) {
	mkdirSync(dirname(link), { recursive: true });
	symlinkSync(target, link, "junction");
}
