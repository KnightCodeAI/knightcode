/**
 * Stage the knightcode binary the packaged app runs as its app server (desktop-shell.md section 15): build it for the
 * target being packaged with scripts/build.ts, copy that build to apps/desktop/resources/knightcode/ (gitignored),
 * and record its version and target beside it, which forge.config.ts checks before packaging.
 *
 *   bun run scripts/stage-server.ts [--platform=win32] [--arch=x64]     (the host's by default)
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(import.meta.dir, "..");
const ROOT = join(DESKTOP, "../..");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const target = `${arg("platform") ?? process.platform}-${arg("arch") ?? process.arch}`;

const built = Bun.spawnSync(["bun", "run", "scripts/build.ts", `--target=${target}`], {
	cwd: ROOT,
	stdout: "inherit",
	stderr: "inherit",
});
if (built.exitCode !== 0) process.exit(built.exitCode || 1);

const from = join(ROOT, "dist", "release", target);
if (!existsSync(from)) {
	console.error(`stage-server: no build at ${from}`);
	process.exit(1);
}
const to = join(DESKTOP, "resources", "knightcode");
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
const { version } = JSON.parse(readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf8")) as {
	version: string;
};
writeFileSync(join(to, "knightcode.version"), `${version}\n`);
writeFileSync(join(to, "knightcode.target"), `${target}\n`);
console.log(`stage-server: knightcode ${version} for ${target} in ${to}`);
