import {
	type Component,
	getKeybindings,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@knightcode/tui";
import type { BackgroundShellInfo, BackgroundShellManager } from "../../../core/background-shells.ts";
import { formatToolDuration } from "../../../core/tools/render-utils.ts";
import { formatSize } from "../../../core/tools/truncate.ts";
import { stripAnsi } from "../../../utils/ansi.ts";
import { sanitizeBinaryOutput } from "../../../utils/shell.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";

/** Durations and live output are redrawn this often. */
const REFRESH_MS = 1000;
/** Rows shown at once in the list; it scrolls past that. */
const MAX_VISIBLE_ROWS = 10;
/** Output lines in the details view's box. */
const OUTPUT_LINES = 10;
/** Command characters shown in the details view. */
const COMMAND_CHARS = 280;
/** Horizontal padding inside a pane. */
const PANE_PAD = 2;
const POINTER = "❯";
const STOP_KEY = "x";

/** `(running)`, `(done)`, `(error)` or `(stopped)`: dim, coloured by outcome. */
function statusLabel(shell: BackgroundShellInfo): string {
	let label: string;
	let color: ThemeColor;
	switch (shell.status) {
		case "running":
			label = shell.stoppedBy ? "stopping" : "running";
			color = shell.stoppedBy ? "warning" : "dim";
			break;
		case "completed":
			label = "done";
			color = "success";
			break;
		case "failed":
		case "timed_out":
			label = "error";
			color = "error";
			break;
		case "stopped":
			label = "stopped";
			color = "warning";
			break;
	}
	return theme.fg(color, `(${label})`);
}

/** The details view's status: the state word in its colour, with the exit code when there is one. */
function statusDetail(shell: BackgroundShellInfo): string {
	const words: Record<BackgroundShellInfo["status"], string> = {
		running: shell.stoppedBy ? "stopping" : "running",
		completed: "completed",
		failed: "failed",
		timed_out: "timed out",
		stopped: "stopped",
	};
	const color: ThemeColor = shell.status === "running" ? "accent" : shell.status === "completed" ? "success" : "error";
	const code = shell.exitCode !== undefined ? ` (exit code: ${shell.exitCode})` : "";
	return theme.fg(color, `${words[shell.status]}${code}`);
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Output lines fit for one terminal row each: no escapes, control characters, or tabs. */
function displayLines(output: string): string[] {
	const lines = sanitizeBinaryOutput(stripAnsi(output)).replace(/\r/g, "").replace(/\t/g, "   ").split("\n");
	while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
	return lines;
}

/** Running commands first, newest first within each group. */
function sortShells(shells: BackgroundShellInfo[]): BackgroundShellInfo[] {
	return [...shells].sort(
		(a, b) => Number(a.status !== "running") - Number(b.status !== "running") || b.startedAt - a.startedAt,
	);
}

/** `Enter to view`: the key, then what it does. */
function hint(key: string, action: string): string {
	return `${key} to ${action}`;
}

/** Key hints joined by middots, dim and italic like every dialog's input guide. */
function inputGuide(hints: string[]): string {
	return theme.fg("dim", theme.italic(hints.join(" · ")));
}

/**
 * A pane: a coloured rule across the terminal, then a bold title, an optional subtitle, the body, and
 * the key hints, indented. Slash-command dialogs share this frame.
 */
function renderPane(
	width: number,
	title: string,
	subtitle: string | undefined,
	body: string[],
	guide: string,
): string[] {
	const pad = " ".repeat(PANE_PAD);
	const inner = Math.max(1, width - PANE_PAD * 2);
	const indent = (line: string) => (line ? pad + truncateToWidth(line, inner, "…") : "");
	return [
		"",
		theme.fg("accent", "─".repeat(Math.max(1, width))),
		indent(theme.bold(theme.fg("accent", title))),
		...(subtitle ? [indent(theme.fg("dim", subtitle))] : []),
		"",
		...body.map(indent),
		"",
		indent(guide),
	];
}

/** A rounded box around `lines`, one column of padding on each side. */
function roundedBox(lines: string[], width: number): string[] {
	const inner = Math.max(1, width - 4);
	const border = (text: string) => theme.fg("border", text);
	return [
		border(`╭${"─".repeat(inner + 2)}╮`),
		...lines.map((line) => {
			const text = truncateToWidth(line, inner, "…");
			return `${border("│")} ${text}${" ".repeat(Math.max(0, inner - visibleWidth(text)))} ${border("│")}`;
		}),
		border(`╰${"─".repeat(inner + 2)}╯`),
	];
}

/** The footer pill's label: `1 shell`, `3 shells`. */
export function backgroundShellsLabel(running: number): string {
	return running === 1 ? "1 shell" : `${running} shells`;
}

/**
 * The background commands pill, a row above the footer while commands run: `2 shells`. Down from an
 * empty prompt selects it, which inverts it; Enter then opens `/tasks`. It sits outside the footer so a
 * custom footer keeps it.
 */
export class BackgroundShellsIndicator implements Component {
	private readonly getManager: () => BackgroundShellManager;
	/** Whether keyboard focus is on the pill instead of the prompt. */
	selected = false;

	constructor(getManager: () => BackgroundShellManager) {
		this.getManager = getManager;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const running = this.getManager().runningCount();
		if (running === 0) {
			this.selected = false;
			return [];
		}
		const label = backgroundShellsLabel(running);
		// SGR 7 directly, like the theme's own colours: chalk's inverse is dropped when it detects no colour support.
		const pill = this.selected ? `\x1b[7m${theme.fg("accent", label)}\x1b[27m` : theme.fg("accent", label);
		const cta = this.selected ? hint("Enter", "view") : hint("↓", "view");
		return [truncateToWidth(`${pill}${theme.fg("dim", ` · ${cta}`)}`, width, "…")];
	}
}

/**
 * The `/tasks` dialog: background commands, each with its status, and one command's details with its
 * live output. With a single command it opens on that command's details.
 */
export class BackgroundTasksComponent implements Component {
	private readonly manager: BackgroundShellManager;
	private readonly tui: TUI;
	private readonly onClose: () => void;
	private readonly unsubscribe: () => void;
	private readonly timer: NodeJS.Timeout;
	private selectedId: string | undefined;
	/** The command whose details are shown, or undefined for the list. */
	private detailId: string | undefined;
	/** Set when the dialog opened on a command's details; going back then closes it if nothing else runs. */
	private skippedList = false;

	constructor(manager: BackgroundShellManager, tui: TUI, onClose: () => void) {
		this.manager = manager;
		this.tui = tui;
		this.onClose = onClose;
		const shells = sortShells(manager.list());
		this.selectedId = shells[0]?.id;
		if (shells.length === 1) {
			this.detailId = shells[0]?.id;
			this.skippedList = true;
		}
		this.unsubscribe = manager.subscribe(() => tui.requestRender());
		this.timer = setInterval(() => tui.requestRender(), REFRESH_MS);
		this.timer.unref?.();
	}

	dispose(): void {
		this.unsubscribe();
		clearInterval(this.timer);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const shells = sortShells(this.manager.list());
		const detail = this.detailId ? shells.find((shell) => shell.id === this.detailId) : undefined;
		if (this.detailId && !detail) {
			// The command was dropped from the list.
			this.detailId = undefined;
		}
		if (!shells.some((shell) => shell.id === this.selectedId)) this.selectedId = shells[0]?.id;
		const lines = detail ? this.renderDetail(detail, width) : this.renderList(shells, width);
		return lines.map((line) => truncateToWidth(line, width, "…"));
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		const shells = sortShells(this.manager.list());
		const detail = this.detailId ? shells.find((shell) => shell.id === this.detailId) : undefined;
		if (detail) {
			if (matchesKey(data, "left")) this.goBack(shells.length);
			else if (
				kb.matches(data, "tui.select.cancel") ||
				kb.matches(data, "tui.select.confirm") ||
				matchesKey(data, "space")
			)
				this.onClose();
			else if (matchesKey(data, STOP_KEY) && detail.status === "running") this.manager.stop(detail.id, "user");
			else return;
			this.tui.requestRender();
			return;
		}

		const index = shells.findIndex((shell) => shell.id === this.selectedId);
		const selected = shells[index];
		if (kb.matches(data, "tui.select.cancel") || matchesKey(data, "left")) {
			this.onClose();
		} else if (kb.matches(data, "tui.select.up")) {
			this.selectedId = shells[Math.max(0, index - 1)]?.id;
		} else if (kb.matches(data, "tui.select.down")) {
			this.selectedId = shells[Math.min(shells.length - 1, index + 1)]?.id;
		} else if (kb.matches(data, "tui.select.confirm") && selected) {
			this.detailId = selected.id;
		} else if (matchesKey(data, STOP_KEY) && selected?.status === "running") {
			this.manager.stop(selected.id, "user");
		} else {
			return;
		}
		this.tui.requestRender();
	}

	/** Back to the list, or closed when the dialog opened on these details and nothing else is listed. */
	private goBack(listed: number): void {
		if (this.skippedList && listed <= 1) {
			this.onClose();
			return;
		}
		this.skippedList = false;
		this.detailId = undefined;
	}

	private renderList(shells: BackgroundShellInfo[], width: number): string[] {
		const running = shells.filter((shell) => shell.status === "running").length;
		const subtitle = running > 0 ? `${running} ${running === 1 ? "active shell" : "active shells"}` : undefined;
		const body: string[] = [];
		if (shells.length === 0) {
			body.push(theme.fg("dim", "No tasks currently running"));
		} else {
			const selected = Math.max(
				0,
				shells.findIndex((shell) => shell.id === this.selectedId),
			);
			const start = Math.max(
				0,
				Math.min(selected - Math.floor(MAX_VISIBLE_ROWS / 2), shells.length - MAX_VISIBLE_ROWS),
			);
			const end = Math.min(start + MAX_VISIBLE_ROWS, shells.length);
			// Pane padding, the pointer, and room for the status label.
			const commandWidth = Math.max(30, width - PANE_PAD * 2 - 2 - 14);
			for (let i = start; i < end; i++) {
				const shell = shells[i];
				if (!shell) continue;
				const isSelected = i === selected;
				const command = truncateToWidth(oneLine(shell.command), commandWidth, "…");
				const pointer = isSelected ? theme.fg("accent", `${POINTER} `) : "  ";
				body.push(`${pointer}${isSelected ? theme.fg("accent", command) : command} ${statusLabel(shell)}`);
			}
			if (start > 0 || end < shells.length) body.push(theme.fg("dim", `  ${selected + 1} of ${shells.length}`));
		}

		const current = shells.find((shell) => shell.id === this.selectedId);
		const hints = [
			...(shells.length > 0 ? [hint("↑/↓", "select"), hint("Enter", "view")] : []),
			...(current?.status === "running" && !current.stoppedBy ? [hint(STOP_KEY, "stop")] : []),
			hint("←/Esc", "close"),
		];
		return renderPane(width, "Background tasks", subtitle, body, inputGuide(hints));
	}

	private renderDetail(shell: BackgroundShellInfo, width: number): string[] {
		const inner = Math.max(1, width - PANE_PAD * 2);
		const runtime = formatToolDuration((shell.endedAt ?? Date.now()) - shell.startedAt);
		const command = oneLine(shell.command);
		const rows: Array<[string, string]> = [
			["Status:", statusDetail(shell)],
			["Runtime:", runtime],
			["Command:", command.length > COMMAND_CHARS ? `${command.slice(0, COMMAND_CHARS - 1)}…` : command],
		];
		const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 1;
		const body: string[] = [];
		for (const [label, value] of rows) {
			const wrapped = wrapTextWithAnsi(value, Math.max(10, inner - labelWidth));
			wrapped.forEach((line, i) => {
				body.push(`${i === 0 ? theme.bold(label.padEnd(labelWidth)) : " ".repeat(labelWidth)}${line}`);
			});
		}
		if (shell.outputFileError) {
			body.push(theme.fg("error", `The output file is incomplete: ${shell.outputFileError}`));
		}

		body.push("", theme.bold("Output:"));
		const lines = displayLines(this.manager.readOutput(shell.id)).slice(-OUTPUT_LINES);
		if (lines.length === 0) {
			body.push(theme.fg("dim", "No output available"));
		} else {
			body.push(...roundedBox(lines, inner));
			// The tail shown is all of the output only while it is this short.
			const total = shell.outputBytes > Buffer.byteLength(lines.join("\n")) + lines.length;
			const shown = `Showing ${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
			body.push(theme.fg("dim", theme.italic(total ? `${shown} of ${formatSize(shell.outputBytes)}` : shown)));
		}

		const hints = [
			hint("←", "go back"),
			hint("Esc/Enter/Space", "close"),
			...(shell.status === "running" && !shell.stoppedBy ? [hint(STOP_KEY, "stop")] : []),
		];
		return renderPane(width, "Shell details", undefined, body, inputGuide(hints));
	}
}
