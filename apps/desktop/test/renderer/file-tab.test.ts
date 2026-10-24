import { parseDiffFromFile } from "@pierre/diffs";
import { expect, test, vi } from "vitest";

vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener: () => {}, knightcode: { platform: "win32" } } });
});

const request = vi.hoisted(() => vi.fn());
vi.mock("../../src/renderer/client.ts", () => ({
	client: { request, onNotification: () => {}, onServerRequest: () => {}, onHostEvent: () => {} },
	RequestError: class extends Error {},
}));
// The tab's neighbours draw web components and load the highlighter; these tests only call its helpers.
vi.mock("../../src/renderer/components/changes.tsx", () => ({ highlighterReady: Promise.resolve() }));
vi.mock("@pierre/trees/react", () => ({ FileTree: () => null, useFileTree: () => ({}) }));

import { changeBlocks, comparisonBase } from "../../src/renderer/components/file-tab.tsx";
import { joinPath, relativeTo, sectionOrder } from "../../src/renderer/components/files-panel.tsx";

test("the comparison's side of a file: its base text, nothing for an added file, null when unchanged", async () => {
	request.mockImplementation(async (method: string, params: { path?: string }) => {
		if (method === "thread/diff/read")
			return {
				root: "C:\\repo",
				fromTree: "a".repeat(40),
				toTree: "b".repeat(40),
				files: [
					{ path: "src/a.ts", status: "modified" },
					{ path: "src/b.ts", oldPath: "src/old.ts", status: "renamed" },
					{ path: "src/new.ts", status: "added" },
				],
			};
		if (method === "thread/diff/file") return { old: `base of ${params.path}`, binary: false, tooLarge: false };
		throw new Error(method);
	});
	// Windows paths match whatever their case and slashes.
	expect(await comparisonBase("t", "c:/REPO/src/a.ts", { scope: "unstaged" })).toBe("base of src/a.ts");
	expect(await comparisonBase("t", "C:\\repo\\src\\b.ts", { scope: "branch", against: "main" })).toBe("base of src/b.ts");
	expect(request).toHaveBeenCalledWith("thread/diff/read", { threadId: "t", scope: "branch", against: "main" });
	expect(request).toHaveBeenCalledWith("thread/diff/file", {
		threadId: "t",
		fromTree: "a".repeat(40),
		toTree: "b".repeat(40),
		path: "src/b.ts",
		oldPath: "src/old.ts",
	});
	expect(await comparisonBase("t", "C:\\repo\\src\\new.ts", { scope: "uncommitted" })).toBe("");
	expect(await comparisonBase("t", "C:\\repo\\README.md", { scope: "unstaged" })).toBeNull();
});

test("a diff's changed sections are its runs of added and deleted lines, in order", () => {
	const old = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
	const next = ["a", "B", "c", "d", "e", "f", "h", "i", "j", "k"].join("\n");
	const blocks = changeBlocks(parseDiffFromFile({ name: "x.txt", contents: old }, { name: "x.txt", contents: next }));
	expect(blocks.map((b) => [b.additionLineIndex + 1, b.additions, b.deletions])).toEqual([
		[2, 1, 1],
		[7, 0, 1],
		[9, 2, 1],
	]);
});

test("tree paths join and split with the root's own separator, Windows without case", () => {
	expect(joinPath("C:\\repo\\", "src/a.ts")).toBe("C:\\repo\\src\\a.ts");
	expect(joinPath("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
	expect(relativeTo("C:\\Repo", "c:/repo/src/a.ts")).toBe("src/a.ts");
	expect(relativeTo("/repo", "/repository/a.ts")).toBeUndefined();
	const entry = (path: string, isDirectory = false) => {
		const segments = path.split("/");
		return { path, segments, basename: segments.at(-1)!, isDirectory, depth: segments.length };
	};
	const sorted = [entry("All files/b.ts"), entry("All files/src", true), entry("Changed files/z.ts"), entry("All files/a10.ts"), entry("All files/a9.ts")]
		.sort(sectionOrder)
		.map((e) => e.path);
	expect(sorted).toEqual(["Changed files/z.ts", "All files/src", "All files/a9.ts", "All files/a10.ts", "All files/b.ts"]);
});
