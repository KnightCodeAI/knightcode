/**
 * A turn's work as the transcript shows it: each tool call is a row named for what it did ("Ran …", "Read …", "Edited
 * …"), consecutive calls fold under one summary row ("Edited files, ran commands", in a fixed part order), and
 * questions and plans stand alone. While a turn runs every call stays in sight, the running one in the present tense.
 * Pure, so tests need no DOM.
 */

import type { BackgroundShell, BackgroundShellNotice, ToolOutput } from "@knightcode/app-server-protocol";
import type { ViewItem } from "./turns.ts";

export type ToolItem = Extract<ViewItem, { type: "toolCall" }>;

/** What a call does, which picks its row, its icon and its part of a group's summary. */
export type Kind = "command" | "explore" | "edit" | "web" | "loaded" | "tools" | "question" | "plan";

export function kindOf(tool: string): Kind {
	switch (tool) {
		case "bash":
		case "powershell":
			return "command";
		case "read":
		case "grep":
		case "find":
		case "ls":
			return "explore";
		case "edit":
		case "write":
			return "edit";
		case "websearch":
		case "webfetch":
			return "web";
		case "tool_search":
			return "loaded";
		case "ask_user":
			return "question";
		case "submit_plan":
			return "plan";
		default:
			return "tools";
	}
}

export const isRunning = (item: ToolItem) => item.status === "pending" || item.status === "running";

// --- shell commands that explore -------------------------------------------------------------------------------

/** What a single shell command reads, searches or lists, as Codex's parse_command makes of it. */
export type Exploration =
	{ type: "read"; path: string } | { type: "search"; query?: string; path?: string } | { type: "list"; path?: string };

/** Codex's short_display_path: the last part of a path that is not build, dist, node_modules or src. */
export function shortPath(path: string): string {
	const trimmed = path.replaceAll("\\", "/").replace(/\/+$/, "");
	const part = trimmed
		.split("/")
		.reverse()
		.find((p) => p && !["build", "dist", "node_modules", "src"].includes(p));
	return part ?? trimmed;
}

/** A command's words, quotes removed and `|` its own word; undefined when it chains, redirects or substitutes. */
function shellWords(command: string): string[] | undefined {
	const words: string[] = [];
	let word = "";
	let quoted = false;
	let quote: string | undefined;
	for (const ch of command.trim()) {
		if (quote) {
			// Only single quotes are literal: `$(...)` and backticks still run inside double quotes.
			if (quote === '"' && (ch === "$" || ch === "`")) return undefined;
			if (ch === quote) quote = undefined;
			else word += ch;
			continue;
		}
		// Before the whitespace test, which would take a newline (a second command) for a space.
		if (";&<>`$(){}\n".includes(ch)) return undefined;
		if (ch === "'" || ch === '"') {
			quote = ch;
			quoted = true;
		} else if (/\s/.test(ch) || ch === "|") {
			if (word || quoted) words.push(word);
			if (ch === "|") words.push("|");
			word = "";
			quoted = false;
		} else word += ch;
	}
	if (quote) return undefined;
	if (word || quoted) words.push(word);
	return words;
}

/** Operands, skipping flags and the values of `valued` flags; `--x=y` is one flag. */
function operands(args: string[], valued: string[] = []): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--") return [...out, ...args.slice(i + 1)];
		if (arg.startsWith("-") && arg.length > 1) {
			if (valued.includes(arg)) i++;
			continue;
		}
		out.push(arg);
	}
	return out;
}

/** Commands that only reshape another's output (Codex's small formatting commands). */
const FORMATTERS = new Set(["head", "tail", "wc", "sort", "uniq", "cut", "tr", "column", "nl", "select-object"]);

/** A single shell command that reads, searches or lists; anything chained or unrecognized is a plain command. */
export const parseExploration = (command: string): Exploration | undefined => {
	const words = shellWords(command);
	return words?.length ? exploration(words) : undefined;
};

function exploration(words: string[]): Exploration | undefined {
	const segments: string[][] = [[]];
	for (const w of words) w === "|" ? segments.push([]) : segments.at(-1)!.push(w);
	const [main = [], ...rest] = segments;
	if (rest.some((s) => !FORMATTERS.has(baseName(s[0] ?? "").toLowerCase()))) return undefined;
	// A formatter that writes a file (`sort -o out`, `uniq in out`) is not reshaping output only.
	if (
		rest.some(
			([name = "", ...a]) =>
				a.some((x) => /^(-o|--output(=|$))/.test(x)) ||
				(baseName(name).toLowerCase() === "uniq" && operands(a, ["-f", "-s", "-w"]).length > 1),
		)
	)
		return undefined;
	const [head = "", ...args] = main;
	const program = baseName(head)
		.replace(/\.exe$/i, "")
		.toLowerCase();
	const read = (path?: string) => (path ? ({ type: "read", path } as const) : undefined);
	switch (program) {
		case "ls":
		case "eza":
		case "exa":
		case "dir":
		case "tree":
		case "get-childitem":
		case "gci": {
			// `tree -o file` writes its listing to a file.
			if (program === "tree" && args.some((a) => a === "-o")) return undefined;
			const path = operands(args, [
				"-I",
				"-w",
				"-L",
				"-P",
				"--format",
				"--color",
				"-Filter",
				"-Depth",
				"-Include",
				"-Exclude",
			])[0];
			return { type: "list", ...(path ? { path: shortPath(path) } : {}) };
		}
		case "rg": {
			const found = operands(args, [
				"-g",
				"--glob",
				"--iglob",
				"-t",
				"--type",
				"--type-not",
				"-m",
				"--max-count",
				"-A",
				"-B",
				"-C",
				"--context",
				"--max-depth",
			]);
			// --pre runs a program on every file searched.
			if (args.some((a) => /^--pre(-glob)?(=|$)/.test(a))) return undefined;
			if (args.includes("--files")) return { type: "list", ...(found[0] ? { path: shortPath(found[0]) } : {}) };
			return {
				type: "search",
				...(found[0] ? { query: found[0] } : {}),
				...(found[1] ? { path: shortPath(found[1]) } : {}),
			};
		}
		case "grep":
		case "egrep":
		case "fgrep":
		case "ag":
		case "ack":
		case "findstr":
		case "select-string":
		case "sls": {
			// ag's and ack's --pager runs a program.
			if (args.some((a) => /^--pager(=|$)/.test(a))) return undefined;
			const pattern = args[args.findIndex((a) => ["-e", "--regexp", "-Pattern"].includes(a)) + 1];
			const named = args.findIndex((a) => a === "-e" || a === "--regexp" || a === "-Pattern");
			const found = operands(named === -1 ? args : args.filter((_, i) => i !== named && i !== named + 1), [
				"-m",
				"--max-count",
				"-A",
				"-B",
				"-C",
				"--context",
				"--include",
				"--exclude",
				"-Path",
				"-Context",
			]);
			const query = named === -1 ? found[0] : pattern;
			const path = named === -1 ? found[1] : found[0];
			return { type: "search", ...(query ? { query } : {}), ...(path ? { path: shortPath(path) } : {}) };
		}
		case "git":
			// `git grep -O<cmd>` runs a program on the matches.
			if (args.some((a) => /^(-O|--open-files-in-pager)/.test(a))) return undefined;
			return args[0] === "grep" ? exploration(["grep", ...args.slice(1)]) : undefined;
		case "fd": {
			if (args.some((a) => ["-x", "-X", "--exec", "--exec-batch"].includes(a) || /^--exec(-batch)?=/.test(a)))
				return undefined;
			const found = operands(args, ["-t", "--type", "-e", "--extension", "-E", "--exclude", "--search-path"]);
			const pathish = (s: string) => /[\\/]|^\.{1,2}$/.test(s);
			if (found.length === 1 && pathish(found[0]!)) return { type: "list", path: shortPath(found[0]!) };
			if (!found.length) return { type: "list" };
			return { type: "search", query: found[0]!, ...(found[1] ? { path: shortPath(found[1]) } : {}) };
		}
		case "find": {
			// These delete, run commands or write files: not exploration.
			const acting = ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"];
			if (args.some((a) => acting.includes(a))) return undefined;
			const path = args.find((a) => !a.startsWith("-") && !["!", "(", ")"].includes(a));
			const name = args.findIndex((a) => ["-name", "-iname", "-path", "-regex"].includes(a));
			const query = name === -1 ? undefined : args[name + 1];
			return query
				? { type: "search", query, ...(path ? { path: shortPath(path) } : {}) }
				: { type: "list", ...(path ? { path: shortPath(path) } : {}) };
		}
		case "cat":
		case "bat":
		case "batcat":
		case "type":
		case "nl": {
			const found = operands(args, ["--theme", "--language", "--style", "--line-range", "-p", "--pattern"]);
			return found.length === 1 ? read(found[0]) : undefined;
		}
		case "get-content":
		case "gc": {
			// As Codex: only the plain forms; anything richer stays a command.
			if (args.some((a) => a.startsWith("-") && !/^-(Raw|Path|LiteralPath|TotalCount|Head|Tail)$/i.test(a)))
				return undefined;
			const found = operands(args, ["-TotalCount", "-Head", "-Tail"]).filter((a) => !/^\d+$/.test(a));
			return found.length === 1 ? read(found[0]) : undefined;
		}
		case "head":
		case "tail": {
			const found = operands(args, ["-n", "-c"]);
			return found.length === 1 ? read(found[0]) : undefined;
		}
		case "sed": {
			// `sed -n '1,200p' file` reads part of a file.
			if (args[0] !== "-n" || !/^\d*(,\d*)?p$/.test(args[1] ?? "")) return undefined;
			return args.length === 3 ? read(args[2]) : undefined;
		}
		default:
			return undefined;
	}
}

/** A shell call's exploration, if it is one. */
export const explorationOf = (item: ToolItem): Exploration | undefined =>
	item.tool === "bash" || item.tool === "powershell" ? parseExploration(str(inputOf(item).command)) : undefined;

/**
 * A call's kind, counting a shell command that only reads, searches or lists as exploration; one left running in the
 * background (`tail -f`) stays a command.
 */
export const kindOfItem = (item: ToolItem): Kind =>
	!item.backgroundShellId && explorationOf(item) ? "explore" : kindOf(item.tool);

export const outputText = (output: ToolOutput[]) =>
	output
		.filter((o): o is Extract<ToolOutput, { type: "text" }> => o.type === "text")
		.map((o) => o.text)
		.join("");

const str = (value: unknown) => (typeof value === "string" ? value : "");
export const inputOf = (item: ToolItem) => (item.input ?? {}) as Record<string, unknown>;

/** A path as the user knows it: relative to the thread's folder when inside it, with forward slashes. */
export function displayPath(path: string, cwd: string): string {
	const slashed = path.replaceAll("\\", "/");
	const root = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
	const inside = root && slashed.toLowerCase().startsWith(`${root.toLowerCase()}/`);
	return inside ? slashed.slice(root.length + 1) : slashed;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Lines a unified diff adds and removes. */
export function diffStats(diff: string): { additions: number; deletions: number } {
	const lines = diff.split("\n");
	return {
		additions: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
		deletions: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
	};
}

/** An edit's patch: the file changes' diffs, joined. */
export const patchOf = (item: ToolItem) =>
	(item.fileChanges ?? [])
		.map((c) => c.diff ?? "")
		.filter(Boolean)
		.join("\n");

/** The path an edit or write names. */
const editPath = (item: ToolItem) =>
	item.fileChanges?.[0]?.path ?? (str(inputOf(item).path) || str(inputOf(item).file_path));

// --- group summaries --------------------------------------------------------------------------------------------

/** Codex's part order: loaded tools, called tools, file changes, exploration, commands, web searches. */
const PARTS: [Kind, (n: number) => string][] = [
	["loaded", (n) => (n === 1 ? "loaded a tool" : "loaded tools")],
	["tools", (n) => (n === 1 ? "called a tool" : "called tools")],
	["edit", (n) => (n === 1 ? "edited a file" : "edited files")],
	["explore", () => "read files"],
	["command", (n) => (n === 1 ? "ran a command" : "ran commands")],
	["web", () => "searched the web"],
];

/** "Edited files, ran commands": a group's parts in Codex's order, the first capitalised. Files count once each. */
export function activitySummary(items: ToolItem[]): string {
	const text = PARTS.flatMap(([kind, phrase]) => {
		const mine = items.filter((i) => kindOfItem(i) === kind);
		const n = kind === "edit" ? new Set(mine.map(editPath)).size : mine.length;
		return n > 0 ? [phrase(n)] : [];
	}).join(", ");
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Worked";
}

/** The kind whose icon heads a group: its summary's first part. */
export const summaryKind = (items: ToolItem[]): Kind =>
	PARTS.find(([kind]) => items.some((i) => kindOfItem(i) === kind))?.[0] ?? "tools";

// --- rows -------------------------------------------------------------------------------------------------------

/** A row's words: `text`, then `path` drawn as a link opening `target`, then the edit's line totals. */
export interface RowLabel {
	text: string;
	path?: string;
	target?: string;
	/** Where the file tab opens: a read's first line, an edit's first change. */
	line?: number;
	stats?: { additions: number; deletions: number };
}

/** The first line of the new side a unified patch changes, past its first hunk's context lines. */
export function firstChangedLine(patch: string | undefined): number | undefined {
	let line: number | undefined;
	for (const text of patch?.split("\n") ?? []) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
		if (hunk) line = Number(hunk[1]);
		else if (line !== undefined && (text.startsWith("+") || text.startsWith("-"))) break;
		else if (line !== undefined && text.startsWith(" ")) line++;
	}
	return line === undefined ? undefined : Math.max(1, line);
}

/** Codex's exploration rows: "Read name", "Searched for query in path", "Listed files in path". */
function explorationLabel(found: Exploration, running: boolean): RowLabel {
	const verb = (done: string, doing: string) => (running ? doing : done);
	switch (found.type) {
		case "read":
			return { text: verb("Read", "Reading"), path: shortPath(found.path), target: found.path };
		case "search":
			return {
				text: `${verb("Searched", "Searching")} for ${found.query ?? "files"}${found.path ? ` in ${found.path}` : ""}`,
			};
		case "list":
			return { text: `${verb("Listed", "Listing")} files${found.path ? ` in ${found.path}` : ""}` };
	}
}

/** What a call did, as its row says it. `background`: how the command a shell call left running stands. */
export function rowLabel(
	item: ToolItem,
	cwd: string,
	open = false,
	background?: BackgroundShell["status"],
): RowLabel {
	const input = inputOf(item);
	const running = isRunning(item);
	const rawPath = str(input.path) || str(input.file_path);
	const path = rawPath ? shortPath(displayPath(rawPath, cwd)) : undefined;
	const verb = (done: string, doing: string) => (running ? doing : done);
	switch (item.tool) {
		case "read": {
			const offset = typeof input.offset === "number" && input.offset >= 1 ? Math.floor(input.offset) : undefined;
			return { ...explorationLabel({ type: "read", path: rawPath }, running), ...(offset ? { line: offset } : {}) };
		}
		case "grep":
		case "find":
			return explorationLabel(
				{ type: "search", ...(str(input.pattern) ? { query: str(input.pattern) } : {}), ...(path ? { path } : {}) },
				running,
			);
		case "ls":
			return explorationLabel({ type: "list", ...(path ? { path } : {}) }, running);
		case "bash":
		case "powershell": {
			if (item.backgroundShellId) return { text: backgroundCallText(firstLine(str(input.command)), background) };
			const found = explorationOf(item);
			if (found && item.status !== "declined") return explorationLabel(found, running);
			const command = str(input.command).trim().split("\n")[0] ?? "";
			return { text: `${item.status === "declined" ? "Declined" : verb("Ran", "Running")} ${command}` };
		}
		case "edit":
		case "write": {
			const kind = item.fileChanges?.[0]?.kind;
			if (open) return { text: kind === "add" ? "Created file" : kind === "delete" ? "Deleted file" : "Edited file" };
			const text =
				item.status === "declined"
					? "Rejected"
					: item.status === "failed"
						? "Stopped editing"
						: running
							? item.tool === "write"
								? "Writing"
								: "Editing"
							: kind === "add"
								? "Created"
								: kind === "delete"
									? "Deleted"
									: "Edited";
			const patch = patchOf(item);
			const line = firstChangedLine(patch);
			return {
				text,
				path: baseName(editPath(item)),
				target: editPath(item),
				...(line ? { line } : {}),
				...(patch ? { stats: diffStats(patch) } : {}),
			};
		}
		case "websearch":
		case "webfetch": {
			const detail = str(input.query) || str(input.url);
			return { text: `${verb("Searched", "Searching")} the web${detail ? ` for ${detail}` : ""}` };
		}
		case "tool_search":
			return { text: `${verb("Loaded", "Loading")} tools${input.query ? ` for ${str(input.query)}` : ""}` };
		case "ask_user": {
			const n = Array.isArray(input.questions) ? input.questions.length : 0;
			return {
				text: running ? `Asking ${n === 1 ? "a question" : "questions"}` : `Asked ${n} question${n === 1 ? "" : "s"}`,
			};
		}
		case "submit_plan":
			return { text: verb("Proposed a plan", "Proposing a plan") };
		case "codemode":
			return { text: verb("Ran code", "Running code") };
		default: {
			const mcp = /^mcp__(.+?)__(.+)$/.exec(item.tool);
			return { text: `${verb("Called", "Calling")} ${mcp ? `${mcp[1]} ${mcp[2]}` : item.tool}` };
		}
	}
}

/** Whether a row opens: reads, searches, listings and web searches show their output only when they failed. */
export function expandable(item: ToolItem): boolean {
	const kind = kindOfItem(item);
	return (
		item.view !== undefined ||
		(kind !== "explore" && kind !== "web") ||
		item.status === "failed" ||
		item.status === "declined"
	);
}

/**
 * What an open row shows. A tool's view wins over the cards picked by name: an extension may override a built-in
 * such as `bash`, and the name alone cannot tell.
 */
export function toolBody(item: ToolItem): "view" | "command" | "edit" | "question" | "plan" | "output" {
	if (item.view) return "view";
	const kind = kindOf(item.tool);
	if (kind === "command") return "command";
	if (kind === "edit" && patchOf(item)) return "edit";
	if (kind === "question" || kind === "plan") return kind;
	return "output";
}

// --- grouping and the live view ---------------------------------------------------------------------------------

export type Entry = { kind: "item"; item: ViewItem } | { kind: "group"; items: ToolItem[] };

/** Questions and plans stand alone, as Codex's request_user_input and proposed plan do; other calls fold together. */
const groupable = (item: ViewItem): item is ToolItem =>
	item.type === "toolCall" && !item.parentItemId && kindOf(item.tool) !== "question" && kindOf(item.tool) !== "plan";

/** Work in order, two or more consecutive calls folded into a group. Nested calls render under their parent. */
export function workEntries(items: ViewItem[]): Entry[] {
	const entries: Entry[] = [];
	const top = items.filter((i) => !(i.type === "toolCall" && i.parentItemId));
	for (let i = 0; i < top.length; i++) {
		const item = top[i]!;
		if (!groupable(item)) {
			entries.push({ kind: "item", item });
			continue;
		}
		const run: ToolItem[] = [item];
		while (top[i + 1] && groupable(top[i + 1]!)) run.push(top[++i] as ToolItem);
		entries.push(run.length > 1 ? { kind: "group", items: run } : { kind: "item", item });
	}
	return entries;
}

/**
 * A thread's sources, as the summary lists them under "Sources": the images the user attached, the MCP servers
 * whose tools ran, and the web when the agent searched or fetched it.
 */
export function threadSources(turns: { items: ViewItem[] }[]): {
	images: { mimeType: string; data: string }[];
	servers: string[];
	web: boolean;
} {
	const images: { mimeType: string; data: string }[] = [];
	const servers = new Set<string>();
	let web = false;
	for (const turn of turns)
		for (const item of turn.items) {
			if (item.type === "userMessage") images.push(...(item.images ?? []));
			if (item.type !== "toolCall") continue;
			if (item.tool === "websearch" || item.tool === "webfetch") web = true;
			const server = /^mcp__(.+?)__/.exec(item.tool)?.[1];
			if (server) servers.add(server);
		}
	return { images, servers: [...servers], web };
}

/**
 * What the model is thinking about, as the "Thinking" status names it: the bold heading its latest reasoning summary
 * opens with ("**Inspecting the repo**"). Reasoning shows only there, never as rows of its own.
 */
export function thinkingHeading(items: ViewItem[]): string | undefined {
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i]!;
		if (item.type !== "reasoning") continue;
		const heading = /^\s*\*\*(.+?)\*\*/.exec(item.text)?.[1]?.trim();
		if (heading) return heading;
	}
	return undefined;
}

// --- commands ---------------------------------------------------------------------------------------------------

export type CommandEnd =
	| { kind: "running" }
	| { kind: "success" }
	| { kind: "exit"; code: string }
	| { kind: "stopped" }
	| { kind: "declined" }
	| { kind: "failed"; text: string };

/** A command's output and how it ended, the shell tool's closing status line taken off the output. */
export function commandResult(item: ToolItem): { output: string; end: CommandEnd } {
	const text = outputText(item.output);
	if (isRunning(item)) return { output: text, end: { kind: "running" } };
	if (item.status === "declined") return { output: "", end: { kind: "declined" } };
	const match =
		/(?:^|\n\n)(Command exited with code (-?\d+)|Command aborted|Command timed out after .+|Tool call cancelled)$/.exec(
			text,
		);
	const output = match ? text.slice(0, match.index) : text;
	if (item.status === "completed") return { output, end: { kind: "success" } };
	if (match?.[2]) return { output, end: { kind: "exit", code: match[2] } };
	if (match && /aborted|cancelled/.test(match[1]!)) return { output, end: { kind: "stopped" } };
	return { output, end: { kind: "failed", text: match?.[1] ?? "Failed" } };
}

// --- background commands ----------------------------------------------------------------------------------------

/** What the transcript knows of a background command: the thread's live entry, or the notice of its end. */
export type BackgroundState = BackgroundShell | BackgroundShellNotice;

/**
 * A background command as the transcript tells it: the thread's entry while it runs, else the notice that reported
 * its end (which has its output), else the entry the thread still keeps. Returns an object it was given, so a store
 * selector can return it.
 */
export function backgroundStateOf(
	shells: BackgroundShell[] | undefined,
	turns: { items: ViewItem[] }[],
	id: string,
): BackgroundState | undefined {
	const live = shells?.find((s) => s.id === id);
	if (live?.status === "running") return live;
	for (const turn of turns)
		for (const item of turn.items) {
			const notice = item.type === "extensionMessage" ? item.backgroundShells?.find((n) => n.id === id) : undefined;
			if (notice) return notice;
		}
	return live;
}

/** The row of the call that started a background command: started while it runs, then stopped or ran. */
export function backgroundCallText(command: string, status: BackgroundShell["status"] | undefined): string {
	if (status === "running") return `Started background terminal with ${command}`;
	if (status === "stopped") return `Background terminal stopped with ${command}`;
	return `Ran ${command}`;
}

/** The row of a notice that a background command ended. */
export const backgroundNoticeText = (notice: BackgroundShellNotice): string =>
	`Background terminal ${notice.status === "stopped" ? "stopped" : "finished"} with ${firstLine(notice.command)}`;

const firstLine = (command: string) => command.trim().split("\n")[0] ?? "";

/** How a background command ended, as the Shell card says it; nothing while it runs or when the thread forgot it. */
export function backgroundEnd(state: BackgroundState | undefined): CommandEnd {
	switch (state?.status) {
		case "completed":
			return { kind: "success" };
		case "stopped":
			return { kind: "stopped" };
		case "timed_out":
			return { kind: "failed", text: "Timed out" };
		case "failed":
			return state.exitCode === undefined
				? { kind: "failed", text: state.error ?? "Failed" }
				: { kind: "exit", code: String(state.exitCode) };
		default:
			return { kind: "running" };
	}
}

// --- questions --------------------------------------------------------------------------------------------------

/** ask_user's questions with the answers its result names (`id: label`, `id: Other: text`, `id: unanswered`). */
export function questionsAndAnswers(item: ToolItem): { question: string; answer?: string }[] {
	const questions = inputOf(item).questions;
	if (!Array.isArray(questions)) return [];
	const lines = outputText(item.output).split("\n");
	return questions.map((q: { id?: unknown; question?: unknown }) => {
		const id = str(q.id);
		const line = lines.find((l) => l.startsWith(`${id}: `))?.slice(id.length + 2);
		const answer =
			!line || line === "unanswered"
				? undefined
				: line.startsWith("Other: ")
					? line.slice("Other: ".length)
					: line.replace("; note: ", " — ");
		return { question: str(q.question), answer };
	});
}

const RECOMMENDED = " (Recommended)";

/** A select's title, split as plan review writes it: the question, then any text after a blank line. */
export function dialogTitle(title: string): { question: string; body?: string } {
	const [question = "", ...rest] = title.split("\n\n");
	const body = rest.join("\n\n").trim();
	return { question, ...(body ? { body } : {}) };
}

/**
 * An option's label and description, from "label — description" as a select writes them, the recommended one marked
 * as Codex marks it (a label ending in " (Recommended)").
 */
export function dialogOption(option: string): { label: string; description?: string; recommended: boolean } {
	const cut = option.indexOf(" — ");
	const label = cut === -1 ? option : option.slice(0, cut);
	const recommended = label.endsWith(RECOMMENDED);
	return {
		label: recommended ? label.slice(0, -RECOMMENDED.length) : label,
		...(cut === -1 ? {} : { description: option.slice(cut + 3) }),
		recommended,
	};
}
