import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { toolKind, toolLocations, toolResultContent, toolTitle } from "../../../src/engine/acp/tools.ts";

const cwd = resolve(process.platform === "win32" ? "C:\\proj" : "/proj");

describe("tool presentation", () => {
	test("maps built-in tools to kinds", () => {
		expect(["read", "edit", "write", "bash", "powershell", "grep", "find", "ls", "custom"].map(toolKind)).toEqual([
			"read",
			"edit",
			"edit",
			"execute",
			"execute",
			"search",
			"search",
			"search",
			"other",
		]);
	});

	test("titles name the file relative to cwd, the command, or the pattern", () => {
		expect(toolTitle("read", { path: "src/a.ts" }, cwd)).toBe(`Read ${join("src", "a.ts")}`);
		expect(toolTitle("edit", { path: join(cwd, "b.ts") }, cwd)).toBe("Edit b.ts");
		expect(toolTitle("write", { path: resolve(cwd, "..", "outside.txt") }, cwd)).toBe(
			`Write ${resolve(cwd, "..", "outside.txt")}`,
		);
		expect(toolTitle("bash", { command: "ls -la" }, cwd)).toBe("ls -la");
		expect(toolTitle("grep", { pattern: "TODO" }, cwd)).toBe("grep TODO");
		expect(toolTitle("custom", { anything: 1 }, cwd)).toBe("custom");
	});

	test("locations are absolute and only for file tools", () => {
		expect(toolLocations("read", { path: "src/a.ts" }, cwd)).toEqual([{ path: join(cwd, "src", "a.ts") }]);
		expect(toolLocations("grep", { pattern: "x", path: "src" }, cwd)).toEqual([{ path: join(cwd, "src") }]);
		expect(toolLocations("grep", { pattern: "x" }, cwd)).toEqual([]);
		expect(toolLocations("bash", { command: "ls" }, cwd)).toEqual([]);
	});

	test("result content passes text and images through", () => {
		expect(
			toolResultContent([
				{ type: "text", text: "out" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			]),
		).toEqual([
			{ type: "content", content: { type: "text", text: "out" } },
			{ type: "content", content: { type: "image", data: "AAAA", mimeType: "image/png" } },
		]);
	});
});
