// Runs each workspace's `test` script one after another. `bun run --filter '*' test` starts every
// suite at once, and on a 4-core CI runner the timing-sensitive ones (worker threads, spawned
// shells, Vitest's 5 s default timeout) time out under the combined load.
// ponytail: replace with `bun run --sequential --workspaces --if-present --no-exit-on-error test`
// once the pinned Bun is 1.3.9 or later.
//
// `--exclude <dir>` (repeatable) skips a workspace: CI runs the slowest suites in jobs of their own
// and everything else here, so a new workspace is tested without a workflow edit.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { exclude: { type: "string", multiple: true } } });
const excluded = new Set(values.exclude);

const { workspaces } = JSON.parse(readFileSync("package.json", "utf8")) as { workspaces: string[] };
const tested = workspaces
	.flatMap((pattern) => [...new Bun.Glob(`${pattern}/package.json`).scanSync()])
	.filter((manifest) => JSON.parse(readFileSync(manifest, "utf8")).scripts?.test)
	.map((manifest) => dirname(manifest).replaceAll("\\", "/"))
	.sort();
// A typo would otherwise run the excluded suite here as well as in its own job.
const unknown = [...excluded].filter((dir) => !tested.includes(dir));
if (unknown.length > 0) throw new Error(`--exclude names no workspace with tests: ${unknown.join(", ")}`);
const dirs = tested.filter((dir) => !excluded.has(dir));

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
