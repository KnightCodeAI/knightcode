import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("strict model generation", () => {
	it("fails before mutating generated data when an Individual model loses tool support", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "knightcode-generate-models-"));
		temporaryRoots.push(fixtureRoot);
		const isolatedPackageRoot = join(fixtureRoot, "package");
		mkdirSync(isolatedPackageRoot);
		for (const entry of ["package.json", "scripts", "src"]) {
			cpSync(join(packageRoot, entry), join(isolatedPackageRoot, entry), { recursive: true });
		}
		const preloadPath = join(fixtureRoot, "mock-models-dev.mjs");
		const modelIds = [
			"deepseek-v4-flash-0731",
			"deepseek-v4-pro",
			"deepseek-v4-pro-0813",
			"glm-5.2",
			"qwen3.6-flash",
			"qwen3.7-max",
			"qwen3.7-plus",
			"qwen3.8-flash",
			"qwen3.8-max",
			"qwen3.8-max-preview",
		];
		const sourceModels = Object.fromEntries(
			modelIds.map((id) => [
				id,
				{
					id,
					name: id,
					tool_call: id !== "deepseek-v4-flash-0731",
				},
			]),
		);
		const catalog = { "alibaba-token-plan": { models: sourceModels } };
		writeFileSync(
			preloadPath,
			`const catalog = ${JSON.stringify(catalog)};\n` +
				`globalThis.fetch = async (input) => {\n` +
				`  if (String(input) === "https://models.dev/api.json") {\n` +
				`    return new Response(JSON.stringify(catalog), { status: 200 });\n` +
				`  }\n` +
				`  throw new Error(\`Unexpected fetch: \${String(input)}\`);\n` +
				`};\n`,
		);

		const generatedPaths = [
			"src/models.generated.ts",
			"src/providers/qwen-token-plan-individual.models.ts",
			"src/providers/data/qwen-token-plan-individual.json",
			"src/providers/data/.manifest.json",
		];
		const sourceBefore = generatedPaths.map((path) => readFileSync(join(packageRoot, path), "utf8"));
		const isolatedBefore = generatedPaths.map((path) => readFileSync(join(isolatedPackageRoot, path), "utf8"));

		const result = spawnSync(
			process.execPath,
			["--import", pathToFileURL(preloadPath).href, "scripts/generate-models.ts", "--strict"],
			{
				cwd: isolatedPackageRoot,
				encoding: "utf8",
				timeout: 10_000,
			},
		);

		expect(result.status).toBe(1);
		expect(`${result.stdout}\n${result.stderr}`).toContain(
			"qwen-token-plan-individual model IDs do not match (missing: deepseek-v4-flash-0731)",
		);
		expect(generatedPaths.map((path) => readFileSync(join(isolatedPackageRoot, path), "utf8"))).toEqual(isolatedBefore);
		expect(generatedPaths.map((path) => readFileSync(join(packageRoot, path), "utf8"))).toEqual(sourceBefore);
	});
});

describe("AgentRouter catalog fallback", () => {
	it("keeps the committed models when every live entry has unusable ratios", () => {
		const fixtureRoot = mkdtempSync(join(tmpdir(), "knightcode-generate-models-"));
		temporaryRoots.push(fixtureRoot);
		const isolatedPackageRoot = join(fixtureRoot, "package");
		mkdirSync(isolatedPackageRoot);
		for (const entry of ["package.json", "scripts", "src"]) {
			cpSync(join(packageRoot, entry), join(isolatedPackageRoot, entry), { recursive: true });
		}

		// A live rate table whose ratios are all unusable, so every entry is skipped and the
		// fetch yields nothing. Dropping the provider is not survivable — the committed
		// catalog has to stand in, exactly as it does for an unreachable endpoint.
		const responses = {
			"https://models.dev/api.json": {
				agentrouter: {
					models: {
						"glm-5.3": { id: "glm-5.3", name: "GLM 5.3", tool_call: true, limit: { context: 200000, output: 8192 } },
					},
				},
			},
			"https://openrouter.ai/api/v1/models": { data: [] },
			"https://ai-gateway.vercel.sh/v1/models": { data: [] },
			"https://agentrouter.org/api/status": { data: { quota_per_unit: 500000 } },
			"https://agentrouter.org/api/pricing": {
				group_ratio: { default: 1 },
				data: [{ model_name: "glm-5.3", quota_type: 0, model_ratio: 0, completion_ratio: 1 }],
			},
		};
		const preloadPath = join(fixtureRoot, "mock-fetch.mjs");
		writeFileSync(
			preloadPath,
			`const responses = ${JSON.stringify(responses)};\n` +
				`globalThis.fetch = async (input) => {\n` +
				`  const body = responses[String(input)];\n` +
				`  if (body === undefined) throw new Error(\`Unexpected fetch: \${String(input)}\`);\n` +
				`  return new Response(JSON.stringify(body), { status: 200 });\n` +
				`};\n`,
		);

		const catalogPath = "src/providers/data/agentrouter.json";
		const committedCatalog = readFileSync(join(isolatedPackageRoot, catalogPath), "utf8");

		const result = spawnSync(
			process.execPath,
			["--import", pathToFileURL(preloadPath).href, "scripts/generate-models.ts"],
			{
				cwd: isolatedPackageRoot,
				encoding: "utf8",
				timeout: 60_000,
			},
		);

		expect(`${result.stdout}\n${result.stderr}`).toContain("Failed to fetch AgentRouter models, keeping the");
		expect(readFileSync(join(isolatedPackageRoot, catalogPath), "utf8")).toBe(committedCatalog);
	});
});
