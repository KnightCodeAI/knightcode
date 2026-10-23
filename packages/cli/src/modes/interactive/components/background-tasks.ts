import { type Component, getKeybindings, matchesKey, type TUI, truncateToWidth } from "@knightcode/tui";
import type { BackgroundShellInfo, BackgroundShellManager } from "../../../core/background-shells.ts";
import { formatToolDuration, shortenPath } from "../../../core/tools/render-utils.ts";
import { stripAnsi } from "../../../utils/ansi.ts";
import { sanitizeBinaryOutput } from "../../../utils/shell.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

/** Rows shown at once in the list; it scrolls past that. */
const MAX_VISIBLE_ROWS = 8;
/** Durations and live output are redrawn this often. */
const REFRESH_MS = 1000;
/** Lines around the output in the details view: header, borders, hints. */
const DETAIL_CHROME_LINES = 12;
const STOP_KEY = "x";

function statusText(shell: BackgroundShellInfo): string {
	switch (shell.status) {
		case "running":
			return shell.stoppedBy ? "stopping" : "running";
		case "completed":
			return "exit 0";
		case "failed":
			return shell.exitCode !== undefined ? `exit ${shell.exitCode}` : "failed";
		case "timed_out":
			return "timed out";
		case "stopped":
			return shell.stoppedBy === "user" ? "stopped by you" : "stopped";
	}
}

function statusColor(shell: BackgroundShellInfo): ThemeColor {
	switch (shell.status) {
		case "running":
			return shell.stoppedBy ? "warning" : "accent";
		case "completed":
			return "success";
		case "failed":
		case "timed_out":
			return "error";
		case "stopped":
			return "muted";
	}
}

function statusGlyph(shell: BackgroundShellInfo): string {
	switch (shell.status) {
		case "running":
			return "●";
		case "completed":
			return "✓";
		case "stopped":
			return "■";
		default:
			return "✗";
	}
}

function elapsed(shell: BackgroundShellInfo, now: number): string {
	return formatToolDuration((shell.endedAt ?? now) - shell.startedAt);
}

/** Output lines fit for one terminal row each: no escapes, control characters, or tabs. */
function displayLines(output: string): string[] {
	const lines = sanitizeBinaryOutput(stripAnsi(output)).replace(/\r/g, "").replace(/\t/g, "   ").split("\n");
	while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
	return lines;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Running commands first, newest first within each group. */
function sortShells(shells: BackgroundShellInfo[]): BackgroundShellInfo[] {
	return [...shells].sort(
		(a, b) => Number(a.status !== "running") - Number(b.status !== "running") || b.startedAt - a.startedAt,
	);
}

/**
 * One row above the footer while background commands run. They outlive the agent's turn, so the
 * working indicator does not cover them; this sits outside the footer so a custom footer keeps it.
 */
export class BackgroundShellsIndicator implements Component {
	private readonly getManager: () => BackgroundShellManager;

	constructor(getManager: () => BackgroundShellManager) {
		this.getManager = getManager;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const running = this.getManager().runningCount();
		if (running === 0) return [];
		const label = `${running} background terminal${running === 1 ? "" : "s"} running`;
		return [
			truncateToWidth(
				`${theme.fg("accent", "●")} ${theme.fg("muted", label)}${theme.fg("dim", " · /tasks to view")}`,
				width,
				"…",
			),
		];
	}
}

/**
 * The `/tasks` view: background commands with their status, and one command's live output. Enter
 * opens a command, x stops it, Escape goes back and then closes.
 */
export class BackgroundTasksComponent implements Component {
	private readonly manager: BackgroundShellManager;
	private readonly tui: TUI;
	private readonly onClose: () => void;
	private readonly unsubscribe: () => void;
	private readonly timer: NodeJS.Timeout;
	private selectedId: string | undefined;
	private detail = false;

	constructor(manager: BackgroundShellManager, tui: TUI, onClose: () => void) {
		this.manager = manager;
		this.tui = tui;
		this.onClose = onClose;
		this.selectedId = sortShells(manager.list())[0]?.id;
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
		let selected = shells.findIndex((shell) => shell.id === this.selectedId);
		if (selected === -1 && shells.length > 0) {
			// The selected command was dropped from the list; keep a valid selection.
			selected = 0;
			this.selectedId = shells[0]?.id;
		}
		const shell = shells[selected];
		const lines = this.detail && shell ? this.renderDetail(shell, width) : this.renderList(shells, selected, width);
		return lines.map((line) => truncateToWidth(line, width, "…"));
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		const shells = sortShells(this.manager.list());
		const index = shells.findIndex((shell) => shell.id === this.selectedId);
		const selected = shells[index];

		if (kb.matches(data, "tui.select.cancel")) {
			if (this.detail) this.detail = false;
			else this.onClose();
		} else if (matchesKey(data, STOP_KEY)) {
			if (selected?.status === "running") this.manager.stop(selected.id, "user");
		} else if (this.detail) {
			return;
		} else if (kb.matches(data, "tui.select.up") && shells.length > 0) {
			this.selectedId = shells[index <= 0 ? shells.length - 1 : index - 1]?.id;
		} else if (kb.matches(data, "tui.select.down") && shells.length > 0) {
			this.selectedId = shells[index >= shells.length - 1 ? 0 : index + 1]?.id;
		} else if (kb.matches(data, "tui.select.confirm") && selected) {
			this.detail = true;
		} else {
			return;
		}
		this.tui.requestRender();
	}

	private renderList(shells: BackgroundShellInfo[], selected: number, width: number): string[] {
		const running = shells.filter((shell) => shell.status === "running").length;
		const ended = shells.length - running;
		const summary = shells.length
			? [running ? `${running} running` : "", ended ? `${ended} ended` : ""].filter(Boolean).join(" · ")
			: "No background commands in this session. The model starts one with run_in_background.";
		const lines = [
			"",
			` ${theme.bold("Background terminals")}`,
			` ${theme.fg("muted", summary)}`,
			"",
			...new DynamicBorder().render(width),
		];

		const now = Date.now();
		const start = Math.max(0, Math.min(selected - Math.floor(MAX_VISIBLE_ROWS / 2), shells.length - MAX_VISIBLE_ROWS));
		const end = Math.min(start + MAX_VISIBLE_ROWS, shells.length);
		for (let i = start; i < end; i++) {
			const shell = shells[i];
			if (!shell) continue;
			const isSelected = i === selected;
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const command = oneLine(shell.command);
			const glyph = theme.fg(statusColor(shell), statusGlyph(shell));
			lines.push(`${cursor}${glyph} ${isSelected ? theme.bold(command) : command}`);
			const lastLine = shell.status === "running" ? displayLines(this.manager.readOutput(shell.id)).at(-1) : undefined;
			const meta = [theme.fg(statusColor(shell), statusText(shell)), elapsed(shell, now), shell.id];
			const metaText = theme.fg("muted", meta.join(" · "));
			lines.push(`    ${metaText}${lastLine ? theme.fg("dim", ` · ${oneLine(lastLine)}`) : ""}`);
		}
		if (start > 0 || end < shells.length) lines.push(theme.fg("muted", `  (${selected + 1}/${shells.length})`));

		lines.push(...new DynamicBorder().render(width));
		const hints = shells.length
			? [
					rawKeyHint("↑↓", "select"),
					keyHint("tui.select.confirm", "output"),
					rawKeyHint(STOP_KEY, "stop"),
					keyHint("tui.select.cancel", "close"),
				]
			: [keyHint("tui.select.cancel", "close")];
		lines.push(` ${hints.join(theme.fg("dim", " · "))}`);
		return lines;
	}

	private renderDetail(shell: BackgroundShellInfo, width: number): string[] {
		const now = Date.now();
		const status = [
			theme.fg(statusColor(shell), statusText(shell)),
			theme.fg("muted", elapsed(shell, now)),
			theme.fg("muted", shortenPath(shell.cwd)),
		].join(theme.fg("dim", " · "));
		const lines = [
			"",
			` ${theme.bold(`Background terminal ${shell.id}`)}`,
			` ${theme.fg("toolOutput", oneLine(shell.command))}`,
			` ${status}`,
			` ${theme.fg("muted", `Output: ${shell.outputPath}`)}`,
		];
		if (shell.outputFileError) lines.push(` ${theme.fg("error", `Output file incomplete: ${shell.outputFileError}`)}`);
		lines.push(...new DynamicBorder().render(width));

		const outputRows = Math.max(3, this.tui.terminal.rows - DETAIL_CHROME_LINES);
		const output = displayLines(this.manager.readOutput(shell.id));
		if (output.length === 0) lines.push(theme.fg("muted", " (no output yet)"));
		else {
			if (output.length > outputRows) {
				lines.push(theme.fg("muted", ` … ${output.length - outputRows} earlier lines in the output file`));
			}
			for (const line of output.slice(-outputRows)) lines.push(` ${theme.fg("toolOutput", line)}`);
		}

		lines.push(...new DynamicBorder().render(width));
		const hints = [
			...(shell.status === "running" && !shell.stoppedBy ? [rawKeyHint(STOP_KEY, "stop")] : []),
			keyHint("tui.select.cancel", "back"),
		];
		lines.push(` ${hints.join(theme.fg("dim", " · "))}`);
		return lines;
	}
}
