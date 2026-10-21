import type { DiffFile } from "@knightcode/app-server-protocol";
import { expect, test, vi } from "vitest";
import {
	clockTime,
	dayLabel,
	isLargeDiff,
	lastCodeBlock,
	matchOffsets,
	mentionPath,
	messageTime,
} from "../../src/renderer/format.ts";

// Local times, so the day boundaries hold in any time zone.
const now = new Date(2026, 9, 19, 15, 0).getTime();
const at = (month: number, day: number, hour = 10, year = 2026) => new Date(year, month, day, hour, 30).getTime();

test("date separators name the day as Codex does", () => {
	expect(dayLabel(at(9, 19, 0), now)).toBe("Today");
	expect(dayLabel(at(9, 18, 23), now)).toBe("Yesterday");
	expect(dayLabel(at(9, 15), now)).toBe(new Date(at(9, 15)).toLocaleDateString(undefined, { weekday: "long" }));
	expect(dayLabel(at(8, 1), now)).toBe(
		new Date(at(8, 1)).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
	);
	// Another year names the year.
	expect(dayLabel(at(9, 1, 10, 2025), now)).toContain("2025");
	// Calendar days: a week ago at a later hour is under 7 x 24 hours old, yet not "this" weekday.
	expect(dayLabel(at(9, 12, 16), now)).toBe(
		new Date(at(9, 12, 16)).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
	);
});

test("a message's time is the clock today, the weekday and clock before that", () => {
	expect(messageTime(at(9, 19), now)).toBe(clockTime(at(9, 19)));
	const yesterday = at(9, 18);
	expect(messageTime(yesterday, now)).toBe(
		`${new Date(yesterday).toLocaleDateString(undefined, { weekday: "long" })} ${clockTime(yesterday)}`,
	);
});

test("find matches case-insensitively, without overlapping, and nothing for an empty query", () => {
	expect(matchOffsets("Git status, git log", "GIT")).toEqual([0, 12]);
	expect(matchOffsets("aaaa", "aa")).toEqual([0, 2]);
	expect(matchOffsets("anything", "")).toEqual([]);
	expect(matchOffsets("short", "longer than text")).toEqual([]);
	// "İ" lowercases to two code units: offsets still point into the original text.
	expect(matchOffsets("İx git", "git")).toEqual([3]);
});

test("the last fenced code block across replies, inner fences and all", () => {
	const first = "Run:\n\n```sh\nnpm test\n```\n";
	const second = "Then:\n~~~ts\nconst a = 1;\n```\nnot a close\n```\n~~~\nand done";
	expect(lastCodeBlock([first, second])).toBe("const a = 1;\n```\nnot a close\n```");
	expect(lastCodeBlock([first, "no code here"])).toBe("npm test");
	expect(lastCodeBlock(["inline `code` only"])).toBeUndefined();
	// CommonMark: a longer closing fence closes, CRLF lines count, an unclosed fence runs to the end.
	expect(lastCodeBlock(["```\na\n````\nafter"])).toBe("a");
	expect(lastCodeBlock(["```\r\nb\r\n```\r\n"])).toBe("b");
	expect(lastCodeBlock(["```\nc\n```", "```\nstill streaming"])).toBe("still streaming");
});

test("a diff is large past Codex's 128 files, 9,000 changed lines or 12 MiB of changed text", () => {
	const file = (additions: number, lines: string[] = []): DiffFile => ({
		path: "a.ts",
		status: "modified",
		binary: false,
		additions,
		deletions: 0,
		hunks: [{ id: "h", header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }],
	});
	expect(isLargeDiff(Array.from({ length: 128 }, () => file(1)))).toBe(false);
	expect(isLargeDiff(Array.from({ length: 129 }, () => file(1)))).toBe(true);
	expect(isLargeDiff([file(4_500), file(4_500)])).toBe(false);
	expect(isLargeDiff([file(4_500), file(4_501)])).toBe(true);
	const twelveMiB = Array.from({ length: 12 }, () => `+${"x".repeat(1024 * 1024)}`);
	expect(isLargeDiff([file(12, [...twelveMiB, " context"])])).toBe(false);
	expect(isLargeDiff([file(13, [...twelveMiB, "+x"])])).toBe(true);
});

test("a dropped file is mentioned relative to the project it is in, else by its whole path", () => {
	vi.stubGlobal("window", { knightcode: { platform: "win32" } });
	try {
		expect(mentionPath("C:\\Work\\app\\src\\a.ts", "c:\\work\\app\\")).toBe("src\\a.ts");
		expect(mentionPath("C:\\Work\\application\\a.ts", "C:\\Work\\app")).toBe("C:\\Work\\application\\a.ts");
		expect(mentionPath("D:\\b.png", undefined)).toBe("D:\\b.png");
	} finally {
		vi.unstubAllGlobals();
	}
});
