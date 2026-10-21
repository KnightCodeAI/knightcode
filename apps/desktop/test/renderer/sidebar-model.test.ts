import type { ThreadSummary } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import {
	nextNeedingAttention,
	PROJECT_PAGE,
	recentThreads,
	selectRows,
	sidebarModel,
	stepThread,
	threadSlots,
} from "../../src/renderer/sidebar-model.ts";

const thread = (
	id: string,
	projectCwd: string,
	status: ThreadSummary["status"] = { type: "idle" },
	times: { createdAt?: string; updatedAt?: string } = {},
): ThreadSummary => ({
	id,
	cwd: projectCwd,
	projectCwd,
	name: `thread ${id}`,
	status,
	archived: false,
	createdAt: times.createdAt ?? "2026-10-19T00:00:00Z",
	updatedAt: times.updatedAt ?? "2026-10-19T00:00:00Z",
	workspaceMode: "local",
});
const same = (a: string, b: string) => a === b;
const ids = (threads: ThreadSummary[]) => threads.map((t) => t.id);

test("go-to-thread slots follow the sidebar: pinned, waiting, open projects' first page, then recents", () => {
	const threads = [
		thread("r1", "/elsewhere"),
		thread("a1", "/a"),
		thread("w1", "/a", { type: "active", waitingOn: ["approval"] }),
		thread("b1", "/b"),
		thread("p1", "/b"),
	];
	const model = sidebarModel(
		threads,
		[
			{ path: "/a", collapsed: false },
			{ path: "/b", collapsed: true },
		],
		["p1"],
		"",
		same,
	);
	expect(ids(model.pinned)).toEqual(["p1"]);
	expect(ids(model.recent)).toEqual(["r1"]);
	// w1 shows under Needs attention and its project, and takes one slot; collapsed /b's threads take none.
	expect(ids(threadSlots(model, []))).toEqual(["p1", "w1", "a1", "r1"]);
	// A folded section's threads are not visible, so they take no slot.
	expect(ids(threadSlots(model, ["pinned", "attention"]))).toEqual(["a1", "w1", "r1"]);
});

test("a project contributes only the threads it shows before Show more", () => {
	const threads = Array.from({ length: PROJECT_PAGE + 3 }, (_, i) => thread(`t${i}`, "/a"));
	const model = sidebarModel(threads, [{ path: "/a", collapsed: false }], [], "", same);
	expect(threadSlots(model, [])).toHaveLength(PROJECT_PAGE);
});

test("a query keeps only threads whose title contains it", () => {
	const model = sidebarModel(
		[thread("x", "/a"), thread("y", "/a")],
		[{ path: "/a", collapsed: false }],
		[],
		"THREAD X",
		same,
	);
	expect(ids(model.projects[0]!.threads)).toEqual(["x"]);
});

test("in one list every unpinned thread is a recent, sorted by the chosen time", () => {
	const old = thread("old", "/a", undefined, { createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" });
	const young = thread("young", "/b", undefined, {
		createdAt: "2026-10-18T00:00:00Z",
		updatedAt: "2026-10-18T00:00:00Z",
	});
	const projects = [{ path: "/a", collapsed: false }];
	const list = sidebarModel([old, young], projects, [], "", same, { organize: "list", sort: "created" });
	expect(list.projects).toEqual([]);
	expect(ids(list.recent)).toEqual(["young", "old"]);
	const grouped = sidebarModel([young, old], projects, [], "", same, { organize: "project", sort: "updated" });
	expect(ids(grouped.projects[0]!.threads)).toEqual(["old"]);
	expect(ids(grouped.recent)).toEqual(["young"]);
});

test("recent slots, the next thread needing attention and stepping wrap as Codex's do", () => {
	const t = (id: string, day: number, status?: ThreadSummary["status"]) =>
		thread(id, "/a", status, { updatedAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z` });
	const [a, b, c, d] = [t("a", 1), t("b", 4, { type: "active", waitingOn: ["approval"] }), t("c", 3), t("d", 2)];
	const threads = [a!, b!, c!, d!];
	expect(ids(recentThreads(threads, 2))).toEqual(["b", "c"]);
	// The slots (what the sidebar shows) come first, then the rest by activity: b waits, a and d are unread.
	const slots = [d!, a!];
	expect(nextNeedingAttention(slots, threads, ["a", "d"], undefined)?.id).toBe("d");
	expect(nextNeedingAttention(slots, threads, ["a", "d"], "a")?.id).toBe("b");
	expect(nextNeedingAttention(slots, threads, ["a", "d"], "b")?.id).toBe("d");
	expect(nextNeedingAttention(slots, threads, [], "c")?.id).toBe("b");
	expect(nextNeedingAttention(slots, [a!], [], "a")).toBeUndefined();
	expect(stepThread(threads, "d", 1)?.id).toBe("a");
	expect(stepThread(threads, "a", -1)?.id).toBe("d");
	expect(stepThread(threads, undefined, -1)?.id).toBe("d");
});

test("modifier clicks toggle rows and select ranges from the last toggled row", () => {
	const order = ["a", "b", "c", "d"];
	let selection = selectRows({ ids: [] }, order, "b", "toggle");
	expect(selection).toEqual({ ids: ["b"], anchor: "b" });
	selection = selectRows(selection, order, "d", "range");
	expect(selection).toEqual({ ids: ["b", "c", "d"], anchor: "b" });
	selection = selectRows(selection, order, "a", "range");
	expect(selection.ids).toEqual(["a", "b"]);
	expect(selectRows(selection, order, "a", "toggle").ids).toEqual(["b"]);
	// A row not in the order (a project page past Show more) starts over.
	expect(selectRows(selection, order, "z", "range")).toEqual({ ids: ["z"], anchor: "z" });
});
