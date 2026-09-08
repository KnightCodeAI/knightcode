import type { ToolCallView } from "./transcript.ts";

/** The handful of shapes the app draws distinctly; everything else gets the generic view. */
export type ToolKind = "shell" | "write" | "edit" | "read" | "search" | "list" | "other";

export function kindOf(name: string): ToolKind {
	switch (name.toLowerCase()) {
		case "bash":
		case "powershell":
			return "shell";
		case "write":
			return "write";
		case "edit":
			return "edit";
		case "read":
			return "read";
		case "grep":
		case "find":
			return "search";
		case "ls":
			return "list";
		default:
			return "other";
	}
}

export interface ToolDescription {
	kind: ToolKind;
	verb: string;
	subject: string;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compactJson(value: unknown, limit = 120): string {
	let text: string;
	try {
		text = JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
	text = text.replace(/\s+/g, " ");
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** One line per call: the verb the row leads with and the thing it acted on. */
export function describeTool(call: ToolCallView): ToolDescription {
	const kind = kindOf(call.name);
	const args = call.args;
	switch (kind) {
		case "shell":
			return { kind, verb: "Ran", subject: (str(args.command) ?? "…").replace(/\s+/g, " ") };
		case "write":
			return { kind, verb: "Created", subject: str(args.path) ?? "…" };
		case "edit":
			return { kind, verb: "Edited", subject: str(args.path) ?? "…" };
		case "read":
			return { kind, verb: "Read", subject: str(args.path) ?? "…" };
		case "search":
			return { kind, verb: call.name.toLowerCase() === "find" ? "Found" : "Searched", subject: str(args.pattern) ?? "…" };
		case "list":
			return { kind, verb: "Listed", subject: str(args.path) ?? "." };
		default:
			return { kind, verb: call.name, subject: compactJson(args) };
	}
}

export interface DiffStats {
	added: number;
	removed: number;
}

function lineCount(text: string): number {
	if (text.length === 0) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** The edit tool's display diff prefixes every line with `+N `, `-N ` or ` N `. */
const ADDED_LINE = /^\+\s*\d+ /;
const REMOVED_LINE = /^-\s*\d+ /;

export function diffStats(call: ToolCallView): DiffStats {
	const kind = kindOf(call.name);
	if (kind === "write") {
		const content = call.args.content;
		return { added: typeof content === "string" ? lineCount(content) : 0, removed: 0 };
	}
	if (kind === "edit") {
		const diff = (call.result?.details as { diff?: unknown } | undefined)?.diff;
		if (typeof diff !== "string") return { added: 0, removed: 0 };
		let added = 0;
		let removed = 0;
		for (const line of diff.split("\n")) {
			if (ADDED_LINE.test(line)) added += 1;
			else if (REMOVED_LINE.test(line)) removed += 1;
		}
		return { added, removed };
	}
	return { added: 0, removed: 0 };
}

export function groupStats(calls: readonly ToolCallView[]): DiffStats {
	return calls.reduce(
		(total, call) => {
			const stats = diffStats(call);
			return { added: total.added + stats.added, removed: total.removed + stats.removed };
		},
		{ added: 0, removed: 0 },
	);
}

const PHRASES: Record<ToolKind, { one: string; many: (count: number) => string }> = {
	shell: { one: "ran a command", many: (n) => `ran ${n} commands` },
	write: { one: "created a file", many: (n) => `created ${n} files` },
	edit: { one: "edited a file", many: (n) => `edited ${n} files` },
	read: { one: "read a file", many: (n) => `read ${n} files` },
	search: { one: "searched once", many: (n) => `searched ${n} times` },
	list: { one: "listed a directory", many: (n) => `listed ${n} directories` },
	other: { one: "called a tool", many: (n) => `called ${n} tools` },
};

/** "Ran 2 commands, created a file" — kinds in first-seen order, first letter capitalised. */
export function summariseTools(calls: readonly ToolCallView[]): string {
	const counts = new Map<ToolKind, number>();
	for (const call of calls) {
		const kind = kindOf(call.name);
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	const text = [...counts].map(([kind, count]) => (count === 1 ? PHRASES[kind].one : PHRASES[kind].many(count))).join(", ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function isRunning(call: ToolCallView): boolean {
	return call.result === undefined;
}

export function outputOf(call: ToolCallView): string {
	return call.result?.text ?? "";
}
