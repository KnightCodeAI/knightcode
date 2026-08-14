import { basename, dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import {
	JSONL_STORAGE_VERSION,
	type JsonlSessionMetadata,
	JsonlSessionRepo,
} from "../../src/harness/session/jsonl/index.ts";
import {
	type ConformanceCase,
	createSessionRepoLifecycleConformance,
	createSessionRepoMessageConformance,
} from "../../src/harness/session/testing/index.ts";
import { getOrThrow } from "../../src/harness/types.ts";
import { createTempDir } from "./session-test-utils.ts";

const NOW = 1_700_000_000_000;
// The repository stores the absolute cwd it resolves, which is platform-shaped.
const WORKSPACE = resolve("/workspace");
const WORKSPACE_A = resolve("/workspace-a");
const WORKSPACE_B = resolve("/workspace-b");
const CONFORMANCE_CWD = WORKSPACE;

function registerConformance(name: string, cases: readonly ConformanceCase[]): void {
	describe(name, () => {
		for (const group of new Set(cases.map((testCase) => testCase.group))) {
			describe(group, () => {
				for (const testCase of cases.filter((candidate) => candidate.group === group)) {
					it(testCase.name, () => testCase.run());
				}
			});
		}
	});
}

let jsonlRepo: JsonlSessionRepo;
async function createConformanceRepo() {
	const fileSystem = new NodeExecutionEnv({ cwd: createTempDir() });
	jsonlRepo = new JsonlSessionRepo({ fileSystem, sessionsRoot: "sessions", now: () => NOW });
	return {
		create: (options: { id?: string; parentSessionId?: string }) =>
			jsonlRepo.create({ ...options, cwd: CONFORMANCE_CWD }),
		open: (metadata: JsonlSessionMetadata) => jsonlRepo.open(metadata),
		list: () => jsonlRepo.list({ cwd: CONFORMANCE_CWD }),
		delete: (metadata: JsonlSessionMetadata) => jsonlRepo.delete(metadata),
	};
}

registerConformance("JsonlSessionRepo conformance", [
	...createSessionRepoLifecycleConformance<JsonlSessionMetadata>(createConformanceRepo, () => jsonlRepo.close()),
	...createSessionRepoMessageConformance<JsonlSessionMetadata>(createConformanceRepo, () => jsonlRepo.close()),
]);

describe("JsonlSessionRepo cwd-scoped lifecycle", () => {
	it("persists metadata and filters discovery by cwd", async () => {
		const fileSystem = new NodeExecutionEnv({ cwd: createTempDir() });
		const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: "sessions", now: () => NOW });
		const session = await repo.create({ id: "child", cwd: WORKSPACE, parentSessionId: "parent" });
		const metadata = session.metadata;

		expect(metadata).toMatchObject({
			id: "child",
			createdAt: NOW,
			storageVersion: JSONL_STORAGE_VERSION,
			cwd: WORKSPACE,
			parentSessionId: "parent",
		});
		// The per-cwd directory name encodes the absolute cwd, whose shape is platform-specific.
		expect(basename(dirname(dirname(metadata.path)))).toBe("sessions");
		expect(basename(dirname(metadata.path))).toMatch(/^--.*workspace--$/);
		expect(metadata.path.endsWith("_child.jsonl")).toBe(true);
		expect(Number.isFinite(metadata.modifiedAt)).toBe(true);
		await session.close();

		expect(await repo.list({ cwd: "/other" })).toEqual([]);
		expect(await repo.list({ cwd: WORKSPACE })).toEqual([metadata]);
		const firstLine = getOrThrow(await fileSystem.readTextLines(metadata.path, { maxLines: 1 }))[0];
		expect(JSON.parse(firstLine!)).toEqual({
			v: 4,
			kind: "header",
			id: "child",
			storageVersion: JSONL_STORAGE_VERSION,
			createdAt: NOW,
			cwd: WORKSPACE,
			parentSessionId: "parent",
		});
		await repo.close();
	});

	it("allows the same id to be active in different working directories", async () => {
		const fileSystem = new NodeExecutionEnv({ cwd: createTempDir() });
		const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: "sessions", now: () => NOW });
		const first = await repo.create({ id: "shared", cwd: WORKSPACE_A });
		const second = await repo.create({ id: "shared", cwd: WORKSPACE_B });

		expect(first.metadata.path).not.toBe(second.metadata.path);
		await expect(repo.create({ id: "shared", cwd: WORKSPACE_A })).rejects.toThrow("already exists");
		expect((await repo.list()).map(({ cwd, id }) => ({ cwd, id }))).toEqual([
			{ cwd: WORKSPACE_A, id: "shared" },
			{ cwd: WORKSPACE_B, id: "shared" },
		]);

		await Promise.all([first.close(), second.close()]);
		const reopened = await Promise.all([repo.open(first.metadata), repo.open(second.metadata)]);
		await Promise.all(reopened.map((session) => session.close()));
		await repo.close();
	});
});
