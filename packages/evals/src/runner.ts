import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocumentationVariant, EvalTask } from "./plan.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const require = createRequire(import.meta.url);
const vitestCli = resolve(dirname(require.resolve("vitest/package.json")), "vitest.mjs");

export type EvalRunContext = {
	artifactDirectory: string;
	provider: string;
	model: string;
	runsPerVariant: number;
};

export function createEvalRunContext(
	artifactDirectory: string,
	provider: string,
	model: string,
	runsPerVariant: number,
): EvalRunContext {
	return { artifactDirectory, provider, model, runsPerVariant };
}

function runVitest(
	context: EvalRunContext,
	variant: DocumentationVariant,
	outputDirectory: string,
	vitestArgs: readonly string[],
): number {
	mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
	const result = spawnSync(
		process.execPath,
		[`--env-file-if-exists=${join(repositoryRoot, ".env")}`, vitestCli, ...vitestArgs],
		{
			cwd: packageRoot,
			stdio: "inherit",
			env: {
				...process.env,
				KNIGHTCODE_EVAL_VARIANT: variant,
				KNIGHTCODE_EVAL_ARTIFACT_DIR: outputDirectory,
				KNIGHTCODE_EVAL_RUNS_PER_VARIANT: String(context.runsPerVariant),
				KNIGHTCODE_PROVIDER: context.provider,
				KNIGHTCODE_MODEL: context.model,
			},
		},
	);
	if (result.error) throw result.error;
	return result.status ?? 1;
}

export function discoverCases(
	context: EvalRunContext,
	variant: DocumentationVariant,
	files: readonly string[],
	vitestArgs: readonly string[],
): string {
	const outputDirectory = join(context.artifactDirectory, "discovery", variant);
	const reportPath = join(outputDirectory, "discovered-tests.json");
	const status = runVitest(context, variant, outputDirectory, [
		"list",
		"--config",
		"vitest.evals.config.ts",
		"--project",
		"docs",
		...files,
		...vitestArgs,
		`--json=${reportPath}`,
	]);
	if (status !== 0) throw new Error(`${variant} eval discovery failed.`);
	return reportPath;
}

function taskDirectoryName(task: EvalTask): string {
	const identity = JSON.stringify([task.evalSet, task.caseId, task.variant, task.model, task.runNumber]);
	return createHash("sha256").update(identity).digest("hex");
}

export function runTask(context: EvalRunContext, task: EvalTask): string | undefined {
	const outputDirectory = join(context.artifactDirectory, "tasks", taskDirectoryName(task));
	const reportPath = join(outputDirectory, "vitest.json");
	const testName = `${task.evalSet} ${task.caseId}`;
	const exactName = `^${testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
	runVitest(context, task.variant, outputDirectory, [
		"run",
		"--config",
		"vitest.evals.config.ts",
		"--project",
		"docs",
		task.file,
		"--testNamePattern",
		exactName,
		"--reporter=vitest-evals/reporter",
		"--reporter=json",
		`--outputFile=${reportPath}`,
	]);
	return existsSync(reportPath) ? reportPath : undefined;
}

/** Eval files are addressed relative to the package so a discovered path and a requested path compare equal. */
export function packageRelativePath(path: string): string {
	const absolute = resolve(packageRoot, path);
	const packageRelative = relative(packageRoot, absolute);
	if (packageRelative.startsWith("..")) throw new Error(`Eval file must be inside ${packageRoot}: ${path}`);
	return packageRelative.replaceAll("\\", "/");
}
