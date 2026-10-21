import type { ThreadSummary } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import { type ArchiveFilter, filterArchived, inactiveThreads, NO_PROJECT } from "../../src/renderer/archive-filter.ts";

const thread = (id: string, projectCwd: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
	id,
	cwd: projectCwd,
	projectCwd,
	name: id,
	status: { type: "idle" },
	archived: true,
	createdAt: "2026-10-01T00:00:00Z",
	updatedAt: "2026-10-01T00:00:00Z",
	workspaceMode: "local",
	...extra,
});
const threads = [
	thread("beta", "/a", { updatedAt: "2026-10-03T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }),
	thread("alpha", "/a", { updatedAt: "2026-10-02T00:00:00Z", workspaceMode: "worktree" }),
	thread("gamma", "/loose", { createdAt: "2026-10-05T00:00:00Z" }),
];
const projects = [{ path: "/a", name: "Alpha project" }];
const run = (filter: Partial<ArchiveFilter>) =>
	filterArchived(
		threads,
		{ query: "", kind: "all", sort: "updated", project: "all", ...filter },
		projects,
		(a, b) => a === b,
		(p) => p.split("/").pop() ?? p,
	).map(([group, list]) => [group, list.map((t) => t.id)]);

test("archived threads group by project, newest update first", () => {
	expect(run({})).toEqual([
		["Alpha project", ["beta", "alpha"]],
		[NO_PROJECT, ["gamma"]],
	]);
});

test("sorting by creation or name reorders within the groups", () => {
	expect(run({ sort: "created" })).toEqual([
		[NO_PROJECT, ["gamma"]],
		["Alpha project", ["alpha", "beta"]],
	]);
	expect(run({ sort: "name" })[0]).toEqual(["Alpha project", ["alpha", "beta"]]);
});

test("kind, project and query narrow the list", () => {
	expect(run({ kind: "worktree" })).toEqual([["Alpha project", ["alpha"]]]);
	expect(run({ project: "none" })).toEqual([[NO_PROJECT, ["gamma"]]]);
	expect(run({ project: "/a", query: "BET" })).toEqual([["Alpha project", ["beta"]]]);
});

test("auto-archive takes idle threads past the limit, never running, kept or recent ones", () => {
	const now = Date.parse("2026-10-19T00:00:00Z");
	const old = "2026-10-01T00:00:00Z";
	const threads = [
		thread("idle-old", "/a", { updatedAt: old }),
		thread("running-old", "/a", { updatedAt: old, status: { type: "active", waitingOn: [] } }),
		thread("pinned-old", "/a", { updatedAt: old }),
		thread("idle-new", "/a", { updatedAt: "2026-10-18T00:00:00Z" }),
	];
	expect(inactiveThreads(threads, 7, now, ["pinned-old"]).map((t) => t.id)).toEqual(["idle-old"]);
	expect(inactiveThreads(threads, 30, now, [])).toEqual([]);
});
