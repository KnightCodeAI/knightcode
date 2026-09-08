import { describe, expect, test } from "vitest";
import { diffStats, groupStats, summariseTools } from "@/lib/tools";
import { toBlocks } from "@/lib/transcript";

let counter = 0;
function message(role: string, content: unknown, extra: Record<string, unknown> = {}): unknown {
	counter += 1;
	return { type: "message", id: `e${counter}`, parentId: null, timestamp: "t", message: { role, content, ...extra } };
}
const text = (value: string): unknown => ({ type: "text", text: value });
const call = (id: string, name: string, args: Record<string, unknown>): unknown => ({ type: "toolCall", id, name, arguments: args });
const result = (toolCallId: string, output: string, details?: unknown): unknown =>
	message("toolResult", [text(output)], { toolCallId, toolName: "x", isError: false, details });

describe("toBlocks", () => {
	test("folds a run of tool calls and their results into one group between assistant messages", () => {
		const blocks = toBlocks([
			message("user", "fix it"),
			message("assistant", [text("Let me look."), call("c1", "bash", { command: "git status" })]),
			result("c1", "clean"),
			message("assistant", [call("c2", "read", { path: "a.ts" })]),
			result("c2", "export {}"),
			message("assistant", [text("Done.")]),
		]);
		expect(blocks.map((block) => block.kind)).toEqual(["user", "assistant", "tools", "assistant"]);
		const group = blocks[2];
		if (group?.kind !== "tools") throw new Error("expected a tools block");
		expect(group.calls.map((entry) => entry.name)).toEqual(["bash", "read"]);
		expect(group.calls[0]?.result?.text).toBe("clean");
		expect(group.calls[1]?.result?.text).toBe("export {}");
		expect(summariseTools(group.calls)).toBe("Ran a command, read a file");
	});

	test("a call with no result yet reads as running, and thinking rides with the text", () => {
		const blocks = toBlocks([
			message("assistant", [{ type: "thinking", thinking: "hmm" }, text("On it."), call("c3", "bash", { command: "ls" })]),
		]);
		expect(blocks[0]).toMatchObject({ kind: "assistant", text: "On it.", thinking: "hmm" });
		const group = blocks[1];
		if (group?.kind !== "tools") throw new Error("expected a tools block");
		expect(group.calls[0]?.result).toBeUndefined();
	});

	test("ignores entries that carry nothing to draw", () => {
		const blocks = toBlocks([
			{ type: "model_change", id: "m", parentId: null, timestamp: "t", provider: "p", modelId: "x" },
			{ type: "session_info", id: "s", parentId: null, timestamp: "t", name: "n" },
			message("user", [{ type: "image", data: "…", mimeType: "image/png" }]),
			{ type: "compaction", id: "c", parentId: null, timestamp: "t", summary: "…" },
			"garbage",
		]);
		expect(blocks).toEqual([{ kind: "note", id: "c", text: "Context compacted" }]);
	});
});

describe("summaries and diff stats", () => {
	test("counts by kind in first-seen order and pluralises", () => {
		const calls = [
			{ id: "1", name: "bash", args: {} },
			{ id: "2", name: "write", args: { content: "a\nb\nc\n" } },
			{ id: "3", name: "bash", args: {} },
			{ id: "4", name: "grep", args: {} },
			{ id: "5", name: "grep", args: {} },
		];
		expect(summariseTools(calls)).toBe("Ran 2 commands, created a file, searched 2 times");
		expect(groupStats(calls)).toEqual({ added: 3, removed: 0 });
	});

	test("reads edit stats from the display diff the edit tool returns", () => {
		const edit = {
			id: "e",
			name: "edit",
			args: { path: "a.ts" },
			result: { text: "ok", isError: false, details: { diff: "  1 keep\n-2 old\n+2 new\n+3 more\n  4 keep" } },
		};
		expect(diffStats(edit)).toEqual({ added: 2, removed: 1 });
	});
});
