import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult } from "@knightcode/agent";
import { type Component, type TUI, visibleWidth } from "@knightcode/tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolRenderContext } from "../src/core/extensions/types.ts";
import { codemodeRenderers } from "../src/extensions/codemode/renderer.ts";
import type { CodemodeNestedCall, CodemodeToolDetails } from "../src/extensions/codemode/tool.ts";
import { keyHint, keyText } from "../src/modes/interactive/components/keybinding-hints.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

const HEADER = { type: "text" as const, text: "Script completed\nWall time 0.1 seconds\nOutput:\n" };
const CWD = join(tmpdir(), "codemode-renderer-project");

function context(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
	return {
		args: { code: "" },
		toolCallId: "call",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: CWD,
		executionStarted: false,
		argsComplete: true,
		isPartial: false,
		expanded: true,
		showImages: false,
		isError: false,
		durationMs: undefined,
		outputPad: 1,
		keyText,
		keyHint,
		...overrides,
	};
}

function plain(component: Component, width: number): string {
	return stripVTControlCharacters(component.render(width).join("\n"))
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function render(
	result: AgentToolResult<CodemodeToolDetails | undefined>,
	isError = false,
	expanded = true,
	width = 200,
	isPartial = false,
): string {
	return plain(
		codemodeRenderers.renderResult!(result, { expanded, isPartial }, theme, context({ isError, expanded, isPartial })),
		width,
	);
}

function tool(code: string): ToolExecutionComponent {
	return new ToolExecutionComponent(
		"codemode",
		"call",
		{ code },
		{},
		codemodeRenderers,
		{ requestRender() {} } as unknown as TUI,
		CWD,
	);
}

describe("codemode renderer", () => {
	beforeAll(() => initTheme("dark"));
	afterEach(() => vi.useRealTimers());

	it.each([20, 40, 80, 120])("keeps a long script header on one line at width %i", (width) => {
		const code = `for (const path of ${JSON.stringify(Array(20).fill("研究/source.ts"))}) text(await tools.read({path}));`;
		const component = codemodeRenderers.renderCall!({ code }, theme, context({ expanded: false }));
		const lines = component.render(width);
		expect(lines).toHaveLength(1);
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
		expect(plain(component, width)).toMatch(/^Codemode\(.*…\)$/);
	});

	it("keeps the options and full highlighted source accessible on expand", () => {
		const code =
			'// @options: {"max_output_tokens":2000}\nconst paths = ["a.ts", "b.ts"];\nfor (const path of paths) {\n  text(await tools.read({path}));\n}';
		const component = tool(code);
		component.updateResult({ content: [HEADER], details: { calls: [] }, isError: false });
		expect(plain(component, 80)).toContain('Codemode(const paths = ["a.ts", "b.ts"];)');
		expect(plain(component, 80)).not.toContain("@options");
		expect(plain(component, 80)).toContain(`${keyText("app.tools.expand")} to expand`);
		component.setExpanded(true);
		const expanded = plain(component, 120);
		for (const line of code.split("\n")) expect(expanded).toContain(line);
		expect(expanded).not.toContain("to expand");
		component.setExpanded(false);
		expect(plain(component, 80)).not.toContain("@options");
	});

	it("hides the wire header and frames the result with the regular continuation marker", () => {
		const component = tool('text("hello")');
		component.updateResult({
			content: [HEADER, { type: "text", text: "hello" }],
			details: { calls: [] },
			isError: false,
		});
		const text = plain(component, 80);
		expect(text).toContain("⎿  Script completed");
		expect(text).toContain("hello");
		expect(text).not.toContain("Wall time");
		expect(text).not.toMatch(/⎿\s*\n/);
	});

	it("uses the Read header, relative paths and line ranges for nested reads", () => {
		const args = JSON.stringify({ path: join(CWD, "src", "index.ts").replaceAll("\\", "/"), offset: 10, limit: 20 });
		const text = render(
			{
				content: [HEADER, { type: "text", text: "hello" }],
				details: { calls: [{ id: "call/1", name: "read", args, status: "ok", durationMs: 5 }] },
			},
			false,
			false,
			80,
		);
		expect(text).toContain("1 call completed");
		expect(text).toMatch(/✓ Read\(src[/\\]index.ts:10-29\)\s+5ms/);
		expect(text).not.toContain('"path"');
		expect(text).not.toContain(CWD);
		expect(text).toContain("\n\nhello");
	});

	it.each([
		["bash", { command: "bun test" }, "Bash(bun test)"],
		["powershell", { command: "Get-Location" }, "PowerShell(Get-Location)"],
		["grep", { pattern: "renderCall", path: "src" }, "Search(/renderCall/ in src)"],
		["write", { path: "notes.md", content: "hello" }, "Write(notes.md)"],
		["edit", { path: "notes.md", oldText: "before", newText: "after" }, "Update(notes.md)"],
	] as const)("uses the regular %s header without starting nested execution", (name, args, expected) => {
		const text = render(
			{ content: [HEADER], details: { calls: [{ id: "call/1", name, args: JSON.stringify(args), status: "ok" }] } },
			false,
			false,
		);
		expect(text).toContain(expected);
		expect(text).not.toContain("Elapsed");
	});

	// PR #511: script failure must not turn a nested Write header into a content preview.
	it.each([false, true])("keeps nested write headers compact after script failure (expanded: %s)", (expanded) => {
		const text = render(
			{
				content: [{ type: "text", text: "Script error: bad result" }],
				details: {
					calls: [
						{
							id: "call/1",
							name: "write",
							args: '{"path":"notes.md","content":"hello"}',
							status: "ok",
							durationMs: 5,
						},
					],
				},
			},
			true,
			expanded,
		);
		expect(text.split("\n").find((line) => line.startsWith("✓"))).toMatch(/^✓ Write\(notes.md\)\s+5ms$/);
	});

	it("uses the cancelled icon without repeating the status in row metadata", () => {
		const text = render(
			{
				content: [HEADER],
				details: {
					calls: [{ id: "call/1", name: "bash", args: '{"command":"bun test"}', status: "cancelled", durationMs: 5 }],
				},
			},
			false,
			false,
		);
		expect(text).toContain("1 call cancelled");
		expect(text.split("\n").find((line) => line.startsWith("⊘"))).toMatch(/^⊘ Bash\(bun test\)\s+5ms$/);
	});

	it.each([40, 80])("keeps nested rows and their duration on one line at width %i", (width) => {
		const component = codemodeRenderers.renderResult!(
			{
				content: [],
				details: {
					calls: [
						{
							id: "call/1",
							name: "read",
							args: JSON.stringify({ path: `src/${"long-directory/".repeat(8)}file.ts` }),
							status: "ok",
							durationMs: 5,
						},
					],
				},
			},
			{ expanded: false, isPartial: false },
			theme,
			context({ expanded: false }),
		);
		const row = component.render(width).find((line) => stripVTControlCharacters(line).startsWith("✓"))!;
		expect(visibleWidth(row)).toBeLessThanOrEqual(width);
		expect(stripVTControlCharacters(row)).toMatch(/…\s+5ms$/);
	});

	it("handles custom tools, model calls and truncated JSON previews", () => {
		const text = render(
			{
				content: [HEADER],
				details: {
					calls: [
						{ id: "call/1", name: "mcp__docs__search", args: '{"query":"rendering","limit":5}', status: "ok" },
						{ id: "call/2", name: "models.classify", args: "scorer/judge", status: "ok" },
						{ id: "call/3", name: "read", args: '{"path":"a/very/long/path...', status: "ok" },
					],
				},
			},
			false,
			false,
		);
		expect(text).toContain('mcp__docs__search query="rendering" limit=5');
		expect(text).toContain("models.classify(scorer/judge)");
		expect(text).toContain('read({"path":"a/very/long/path...)');
	});

	it("shows the cost of model calls and their total", () => {
		const call = { name: "models.classify", args: "scorer/judge", status: "ok" as const, durationMs: 5 };
		const text = render({
			content: [HEADER],
			details: {
				calls: [
					{ ...call, id: "call/1", cost: 0.000012936 },
					{ ...call, id: "call/2", cost: 0.02 },
					{ ...call, id: "call/3" },
				],
			},
		});
		expect(text).toMatch(/models.classify\(scorer\/judge\)\s+5ms · \$0.000013/);
		expect(text).toMatch(/models.classify\(scorer\/judge\)\s+5ms · \$0.02/);
		expect(text).toContain("Model calls: $0.02");
	});

	it("summarizes every call while showing only the latest eight", () => {
		const calls: CodemodeNestedCall[] = Array.from({ length: 12 }, (_, i) => ({
			id: `call/${i}`,
			name: `tool_${i}`,
			args: "",
			status: i === 0 ? "error" : i === 11 ? "running" : i === 10 ? "cancelled" : "ok",
		}));
		const result = { content: [], details: { calls } };
		const text = render(result, false, false, 200, true);
		expect(text).toContain("9 calls completed, 1 call running, 1 call failed, 1 call cancelled");
		expect(text).toContain("4 earlier calls");
		expect(text).not.toContain("tool_0");
		expect(text.match(/[✓…⊘] tool_/g)).toHaveLength(8);
		const expanded = render(result);
		expect(expanded).toContain("✗ tool_0");
		expect(expanded).not.toContain("earlier calls");
	});

	it("shows nested errors when collapsed and keeps all error lines and arguments on expand", () => {
		const args = '{"path":"missing.ts"}';
		const error = "File not found: missing.ts\nCheck the working directory";
		const result = {
			content: [HEADER],
			details: { calls: [{ id: "call/1", name: "read", args, status: "error" as const, error }] },
		};
		expect(render(result, true, false)).toContain("File not found: missing.ts");
		const expanded = render(result, true);
		expect(expanded).toContain(args);
		expect(expanded).toContain("Check the working directory");
	});

	it("shows rejected input without requiring a script header", () => {
		expect(
			render(
				{
					content: [{ type: "text", text: "The @options line must be followed by JavaScript source" }],
					details: undefined,
				},
				true,
			),
		).toBe("Script failed\n\nThe @options line must be followed by JavaScript source");
	});

	it("reports a script failure even when its nested calls succeeded", () => {
		const text = render(
			{
				content: [{ type: "text", text: "Script error: bad result" }],
				details: { calls: [{ id: "call/1", name: "read", args: '{"path":"a.ts"}', status: "ok" }] },
			},
			true,
			false,
		);
		expect(text).toContain("Script failed · 1 call completed");
		expect(text).toContain("Script error: bad result");
	});

	it("limits collapsed output to five wrapped lines", () => {
		const text = render(
			{
				content: [HEADER, { type: "text", text: "x".repeat(1000) }],
				details: { calls: [], fullOutputPath: "/tmp/out.txt" },
			},
			false,
			false,
			50,
		);
		const lines = text.split("\n");
		const start = lines.findIndex((line) => line === "x".repeat(50));
		expect(lines.slice(start, start + 5)).toEqual(Array(5).fill("x".repeat(50)));
		expect(lines[start + 5]).toMatch(/^\.\.\. \(15 more lines,/);
		expect(text).toContain("Full output: /tmp/out.txt");
	});

	it("keeps the hidden-line count when the expand hint does not fit", () => {
		const text = render(
			{ content: [HEADER, { type: "text", text: "x".repeat(400) }], details: { calls: [] } },
			false,
			false,
			20,
		);
		expect(text).toContain("... (15 more lines)");
	});

	it.each([false, true])("replaces wire truncation notices with one full-output link (expanded: %s)", (expanded) => {
		const output =
			"Warning: truncated output (original token count: 10957)\nTotal output lines: 14\n\nActual output\n\n[Full output: /tmp/out.txt (read with offset/limit)]";
		const text = render(
			{ content: [HEADER, { type: "text", text: output }], details: { calls: [], fullOutputPath: "/tmp/out.txt" } },
			false,
			expanded,
		);
		expect(text).toContain("Actual output");
		expect(text).toContain("Output truncated · Full output: /tmp/out.txt");
		expect(text.match(/Full output:/g)).toHaveLength(1);
		expect(text).not.toContain("original token count");
		expect(text).not.toContain("Total output lines");
	});

	it("preserves image fallback text", () => {
		const text = render({
			content: [HEADER, { type: "image", data: "", mimeType: "image/png" }],
			details: { calls: [] },
		});
		expect(text).toContain("image/png");
	});

	it("shows elapsed time while running and total duration when finished", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const component = tool("");
		component.markExecutionStarted();
		component.updateResult({ content: [], details: { calls: [] }, isError: false }, true);
		vi.advanceTimersByTime(3_000);
		expect(plain(component, 120)).toContain("Elapsed 3.0s");
		component.updateResult({ content: [], details: { calls: [] }, isError: false, durationMs: 5_100 }, false);
		expect(plain(component, 120)).toContain("Took 5.1s");
		expect(plain(component, 120)).not.toContain("Elapsed");
		expect(vi.getTimerCount()).toBe(0);
	});
});
