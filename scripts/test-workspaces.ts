// Runs each workspace's `test` script one after another. `bun run --filter '*' test` starts every
// suite at once, and on a 4-core CI runner the timing-sensitive ones (worker threads, spawned
// shells, Vitest's 5 s default timeout) time out under the combined load.
// ponytail: replace with `bun run --sequential --workspaces --if-present --no-exit-on-error test`
// once the pinned Bun is 1.3.9 or later.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

const { workspaces } = JSON.parse(readFileSync("package.json", "utf8")) as { workspaces: string[] };
const dirs = workspaces
	.flatMap((pattern) => [...new Bun.Glob(`${pattern}/package.json`).scanSync()])
	.filter((manifest) => JSON.parse(readFileSync(manifest, "utf8")).scripts?.test)
	.map(dirname)
	.sort();

const failed: string[] = [];
for (const dir of dirs) {
	console.log(`\n=== ${dir}`);
	const { exitCode } = Bun.spawnSync([process.execPath, "run", "test"], {
		cwd: dir,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (exitCode !== 0) failed.push(dir);
}
if (failed.length > 0) {
	console.error(`\nFailed: ${failed.join(", ")}`);
	process.exit(1);
}
