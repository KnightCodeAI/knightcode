// `bun run verify`: every check the MVP's stop condition rests on, in order, counting failures (part-4-verify.md,
// Task 4.5). Prints each result, then "MVP VERIFIED" and exits 0 only when nothing failed.
//
//   bun scripts/verify.ts            everything
//   bun scripts/verify.ts --quick    only the fast static checks (5 to 9), for iterating
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(app, "../..");
const quick = process.argv.includes("--quick");
const results: { name: string; ok: boolean; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string): void {
	results.push({ name, ok, ...(detail ? { detail } : {}) });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail.replaceAll("\n", "\n      ")}` : ""}`);
}

/** Runs a command with its output shown; true when it exits 0. */
async function run(name: string, command: string, cwd: string, env: Record<string, string> = {}): Promise<boolean> {
	console.log(`\n── ${name}\n   $ ${command}   (in ${relative(root, cwd) || "."})`);
	const ok = await new Promise<boolean>((done) =>
		spawn("bash", ["-c", command], { cwd, env: { ...process.env, ...env }, stdio: "inherit" }).on("close", (code) => done(code === 0)),
	);
	record(name, ok);
	return ok;
}

/** Runs a command and returns its output (shown too). */
async function capture(command: string, cwd: string, show = true): Promise<{ ok: boolean; output: string }> {
	const child = spawn("bash", ["-c", command], { cwd, env: process.env });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => (stdout += chunk));
	child.stderr.on("data", (chunk) => (stderr += chunk));
	const code = await new Promise<number | null>((done) => child.on("close", done));
	if (show) {
		process.stdout.write(stdout);
		process.stderr.write(stderr);
	}
	return { ok: code === 0, output: `${stdout}\n${stderr}` };
}

const at = (path: string) => join(root, path);

if (!quick) {
	// 1. Types: the repository, then the apps and packages the root tsc does not cover.
	await run("check-types (repository)", "bun run check-types", root);
	await run("typecheck apps/bots", "bun run typecheck", at("apps/bots"));
	await run("typecheck apps/bots/web", "bun run typecheck", at("apps/bots/web"));
	await run("typecheck packages/bots-ui", "bun run typecheck", at("packages/bots-ui"));
	await run("check-types apps/desktop", "bun run check-types", at("apps/desktop"));

	// 2. Unit and Worker tests.
	for (const dir of ["packages/bots-protocol", "packages/bots-ui", "packages/env", "apps/bots", "apps/desktop"])
		await run(`vitest ${dir}`, "bunx vitest --run", at(dir));

	// 3. The browser suite against the real Worker, the stop conditions included.
	await run("playwright ui (real backend, stop conditions included)", "bunx playwright test --project=ui --reporter=line", at("apps/bots/web"), { BOTS_BACKEND: "real" });

	// 4. The reference comparison, when the local reference captures exist.
	const referenceDir = process.env.BOTS_REFERENCE_DIR ?? resolve(root, "../kc-bots-reference");
	if (existsSync(join(referenceDir, "screens")))
		await run("playwright reference", "bunx playwright test --project=reference --reporter=line", at("apps/bots/web"));
	else record("playwright reference (no reference captures here; skipped)", true);
}

// 5. The visible tool definitions stay under their budget.
await run("tool budget", "bun scripts/tool-budget.ts", app);

// 6. The production bundle builds and stays under 10 MB compressed.
{
	console.log("\n── production bundle (dry run)");
	const built = await capture("bun run build", at("apps/bots/web"));
	const dry = built.ok ? await capture("bunx wrangler deploy --dry-run --env production --outdir .wrangler/dry", app) : built;
	const gzip = /gzip:\s*([\d.]+)\s*KiB/.exec(dry.output)?.[1];
	const kib = gzip ? Number(gzip) : Number.NaN;
	record("production bundle under 10 MB compressed", dry.ok && kib < 10 * 1024, Number.isFinite(kib) ? `${kib} KiB gzip` : "no size reported");
}

// 7. No banned word in any tracked file this branch changed.
{
	const bannedFile = resolve(root, "../kc-bots-reference/banned.txt");
	if (!existsSync(bannedFile)) record("banned words (no banned.txt here; skipped)", true);
	else {
		const patterns = readFileSync(bannedFile, "utf8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((source) => new RegExp(source, "i"));
		const base = (await capture("git merge-base main HEAD", root, false)).output.trim().split("\n")[0]!;
		// The text this branch wrote: every line it added to the files it changed (older lines from main are not its own).
		const diff = (await capture(`git diff -U0 --no-color --diff-filter=d ${base}`, root, false)).output.split("\n");
		const changed = new Set<string>();
		const hits: string[] = [];
		let file = "";
		let line = 0;
		for (const text of diff) {
			if (text.startsWith("+++ ")) {
				file = text.slice(6);
				changed.add(file);
			} else if (text.startsWith("@@")) line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
			else if (text.startsWith("+")) {
				// The pattern itself is never printed: only where it matched.
				if (patterns.some((pattern) => pattern.test(text.slice(1)))) hits.push(`${file}:${line}`);
				line++;
			}
		}
		record(`banned words in the lines this branch added (${changed.size} files)`, hits.length === 0, hits.slice(0, 20).join("\n") || undefined);
	}
}

// 8. Prose lines in the spec and the help pages are at most 80 characters (tables and code blocks aside).
{
	const files = [at("apps/bots/docs/design.md"), ...readdirSync(at("apps/bots/docs/help")).filter((name) => name.endsWith(".md")).map((name) => at(`apps/bots/docs/help/${name}`))];
	const long: string[] = [];
	for (const file of files) {
		let code = false;
		readFileSync(file, "utf8")
			.split("\n")
			.forEach((line, index) => {
				if (line.startsWith("```")) code = !code;
				else if (!code && !line.startsWith("|") && line.length > 80) long.push(`${relative(root, file)}:${index + 1} (${line.length})`);
			});
	}
	record("prose lines at most 80 characters", long.length === 0, long.slice(0, 20).join("\n") || undefined);
}

// 9. No hardcoded model choice: no catalog model id as a quoted string in the bots code.
{
	const { builtinModels } = await import("@knightcode/ai/providers/all");
	// Ids that are also plain words ("auto" is an approval mode as well as a router's model) are not model choices;
	// a model id carries a version or a separator.
	const ids = new Set(
		builtinModels()
			.getAllModels()
			.map((model: { id: string }) => model.id)
			.filter((id: string) => /[-./:\d]/.test(id)),
	);
	const skip = new Set(["node_modules", ".wrangler", "dist", "test-results", "playwright-report", "__screenshots__", ".turbo"]);
	const found: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			if (skip.has(name)) continue;
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|tsx|js|json)$/.test(name))
				readFileSync(path, "utf8")
					.split("\n")
					.forEach((line, index) => {
						for (const match of line.matchAll(/["'`]([^"'`\s]{2,80})["'`]/g))
							if (ids.has(match[1]!)) found.push(`${relative(root, path)}:${index + 1} ${match[1]}`);
					});
		}
	};
	for (const dir of ["apps/bots", "packages/bots-protocol", "packages/bots-ui"]) walk(at(dir));
	record(`no hardcoded model ids (${ids.size} catalog ids)`, found.length === 0, found.slice(0, 20).join("\n") || undefined);
}

const failures = results.filter((result) => !result.ok);
console.log(`\n${results.length} checks, ${failures.length} failures`);
for (const failure of failures) console.log(`  failed: ${failure.name}`);
if (failures.length === 0) {
	// Only the full run verifies the MVP.
	console.log(quick ? "QUICK CHECKS PASSED (run without --quick to verify the MVP)" : "MVP VERIFIED");
	process.exit(0);
}
console.log(`MVP NOT VERIFIED: ${failures.length} failures`);
process.exit(1);
