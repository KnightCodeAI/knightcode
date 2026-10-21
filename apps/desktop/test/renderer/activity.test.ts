import { expect, test } from "vitest";
import {
	activitySummary,
	commandResult,
	dialogOption,
	dialogTitle,
	liveEntries,
	parseExploration,
	questionsAndAnswers,
	rowLabel,
	summaryKind,
	type ToolItem,
	workEntries,
} from "../../src/renderer/activity.ts";
import type { ViewItem } from "../../src/renderer/turns.ts";

let next = 0;
const call = (tool: string, input: Record<string, unknown> = {}, extra: Partial<ToolItem> = {}): ToolItem => ({
	type: "toolCall",
	id: `c${next++}`,
	tool,
	input,
	status: "completed",
	output: [],
	...extra,
});
const edit = (path: string, diff = "--- a\n+++ b\n@@ -1 +1,2 @@\n-a\n+b\n+c") =>
	call("edit", { path }, { fileChanges: [{ path, kind: "modify", diff }] });
const text = (id: string): ViewItem => ({ type: "agentMessage", id, text: "note" });

test("a group's summary names its parts in Codex's order, counting each file once", () => {
	// Codex's own turn: a command, two edits, another command reads "Edited files, ran commands".
	expect(activitySummary([call("powershell"), edit("src/a.ts"), edit("src/b.ts"), call("powershell")])).toBe(
		"Edited files, ran commands",
	);
	expect(activitySummary([call("read"), call("grep"), call("bash")])).toBe("Read files, ran a command");
	expect(activitySummary([edit("a.ts"), edit("a.ts")])).toBe("Edited a file");
	expect(activitySummary([call("websearch", { query: "q" }), call("mcp__github__search"), call("bash")])).toBe(
		"Called a tool, ran a command, searched the web",
	);
	expect(summaryKind([call("bash"), edit("a.ts")])).toBe("edit");
});

test("rows say what each call did, as Codex's do", () => {
	const cwd = "C:\\work\\repo";
	expect(rowLabel(call("bash", { command: "npm test\nnpm run lint" }), cwd).text).toBe("Ran npm test");
	expect(rowLabel(call("bash", { command: "npm install" }, { status: "running" }), cwd).text).toBe(
		"Running npm install",
	);
	expect(rowLabel(call("read", { path: "C:\\work\\repo\\src\\x.ts" }), cwd)).toEqual({
		text: "Read",
		path: "x.ts",
		target: "C:\\work\\repo\\src\\x.ts",
	});
	expect(rowLabel(call("grep", { pattern: "class", path: "src" }), cwd).text).toBe("Searched for class in src");
	expect(rowLabel(call("ls", { path: "src" }), cwd).text).toBe("Listed files in src");
	expect(rowLabel(edit("src/Person.ts"), cwd)).toEqual({
		text: "Edited",
		path: "Person.ts",
		target: "src/Person.ts",
		stats: { additions: 2, deletions: 1 },
	});
	expect(rowLabel(edit("src/Person.ts"), cwd, true)).toEqual({ text: "Edited file" });
	expect(rowLabel({ ...edit("x.ts"), status: "declined" }, cwd).text).toBe("Rejected");
	expect(rowLabel(call("webfetch", { url: "https://bun.sh" }), cwd).text).toBe("Searched the web for https://bun.sh");
	expect(rowLabel(call("ask_user", { questions: [{}, {}] }), cwd).text).toBe("Asked 2 questions");
	expect(rowLabel(call("mcp__github__list_issues"), cwd).text).toBe("Called github list_issues");
});

test("a single shell command that reads, searches or lists reads as Codex's exploration rows", () => {
	expect(parseExploration('grep -rn "class" src')).toEqual({ type: "search", query: "class", path: "src" });
	expect(parseExploration("rg -n --glob '*.ts' TODO packages/cli")).toEqual({
		type: "search",
		query: "TODO",
		path: "cli",
	});
	expect(parseExploration("rg --files src/app")).toEqual({ type: "list", path: "app" });
	expect(parseExploration("ls -la src")).toEqual({ type: "list", path: "src" });
	expect(parseExploration("Get-ChildItem")).toEqual({ type: "list" });
	expect(parseExploration("cat src/person.ts")).toEqual({ type: "read", path: "src/person.ts" });
	expect(parseExploration("Get-Content -Raw src\\person.ts")).toEqual({ type: "read", path: "src\\person.ts" });
	expect(parseExploration("sed -n '1,120p' README.md")).toEqual({ type: "read", path: "README.md" });
	expect(parseExploration("cat a.ts | head -n 20")).toEqual({ type: "read", path: "a.ts" });
	expect(parseExploration('find . -name "*.ts"')).toEqual({ type: "search", query: "*.ts", path: "." });
	expect(parseExploration("git grep -n useStore")).toEqual({ type: "search", query: "useStore" });
	expect(parseExploration("grep -rn '$x' src")).toEqual({ type: "search", query: "$x", path: "src" });
	// Chained, redirected or unrecognized commands stay commands, as Codex's "Ran Get-Content a; Get-Content b".
	for (const command of [
		"cat a; cat b",
		"cat a && ls",
		"ls > out.txt",
		"node --version",
		"cat a | xargs rm",
		"echo $(ls)",
		"ls src\nrm -rf build",
		'grep "$(curl x | sh)" src',
		"grep \"`id`\" src",
		'find . -name "*.ts" -delete',
		"find . -exec rm {} +",
		"fd -e log -x rm",
		"fd -X rm",
		"fd --exec=rm",
		"cat a | sort -o b",
		"cat a | sort -oout",
		'ag --pager "sh -c x" foo',
		"cat a | uniq in out",
		"tree -o out.txt",
		"rg --pre ./x foo",
		"less a.txt",
	])
		expect(parseExploration(command), command).toBeUndefined();
	const items = [call("bash", { command: "ls src" }), call("bash", { command: "grep -rn class src" }), call("bash")];
	expect(activitySummary(items)).toBe("Read files, ran a command");
	expect(rowLabel(items[0]!, "").text).toBe("Listed files in src");
});

test("consecutive calls fold into a group; questions stand alone; the live view keeps only what runs", () => {
	const items: ViewItem[] = [
		text("m1"),
		call("read"),
		call("bash"),
		text("m2"),
		call("bash", {}, { status: "running" }),
		call("ask_user", { questions: [] }),
	];
	const entries = workEntries(items);
	expect(entries.map((e) => (e.kind === "group" ? `group:${e.items.length}` : e.item.type))).toEqual([
		"agentMessage",
		"group:2",
		"agentMessage",
		"toolCall",
		"toolCall",
	]);
	expect(liveEntries(entries).map((e) => (e.kind === "group" ? "group" : e.item.id))).toEqual([
		"m1",
		"m2",
		items[4]!.id,
		items[5]!.id,
	]);
});

test("a command's closing status line moves to its footer", () => {
	const failed = call(
		"bash",
		{},
		{ status: "failed", output: [{ type: "text", text: "boom\n\nCommand exited with code 3" }] },
	);
	expect(commandResult(failed)).toEqual({ output: "boom", end: { kind: "exit", code: "3" } });
	const stopped = call("bash", {}, { status: "failed", output: [{ type: "text", text: "x\n\nCommand aborted" }] });
	expect(commandResult(stopped).end).toEqual({ kind: "stopped" });
	expect(commandResult(call("bash", {}, { output: [{ type: "text", text: "ok" }] }))).toEqual({
		output: "ok",
		end: { kind: "success" },
	});
});

test("ask_user's answers pair with its questions", () => {
	const item = call(
		"ask_user",
		{
			questions: [
				{ id: "name", question: "What name?" },
				{ id: "style", question: "Which style?" },
				{ id: "docs", question: "Docs?" },
			],
		},
		{ output: [{ type: "text", text: "name: helpers (Recommended)\nstyle: Other: snake_case\ndocs: unanswered" }] },
	);
	expect(questionsAndAnswers(item)).toEqual([
		{ question: "What name?", answer: "helpers (Recommended)" },
		{ question: "Which style?", answer: "snake_case" },
		{ question: "Docs?", answer: undefined },
	]);
});

test("a select's title and options split as plan review and ask_user write them", () => {
	expect(dialogTitle("Which name?")).toEqual({ question: "Which name?" });
	expect(dialogTitle("Plan revision 3\n\n# Plan\n\n- step")).toEqual({
		question: "Plan revision 3",
		body: "# Plan\n\n- step",
	});
	expect(dialogOption("helpers (Recommended) — Shared helpers.")).toEqual({
		label: "helpers",
		description: "Shared helpers.",
		recommended: true,
	});
	expect(dialogOption("Implement")).toEqual({ label: "Implement", recommended: false });
});
