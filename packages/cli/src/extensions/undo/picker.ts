import { type Component, truncateToWidth } from "@knightcode/tui";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";

export interface UndoRow {
	id: string;
	text: string;
	/** ISO timestamp of the session entry. */
	timestamp: string;
	/** Files an undo to this message would restore. */
	files: number;
	shellRan: boolean;
}

const MAX_VISIBLE = 10;

/** Picker of user messages to undo back to, mounted through `ctx.ui.custom`. */
export class UndoPicker implements Component {
	private readonly rows: UndoRow[];
	private readonly keybindings: KeybindingsManager;
	private readonly done: (id: string | undefined) => void;
	private selectedIndex: number;
	private readonly border = new DynamicBorder();

	constructor(rows: UndoRow[], keybindings: KeybindingsManager, done: (id: string | undefined) => void) {
		this.rows = rows;
		this.keybindings = keybindings;
		this.done = done;
		this.selectedIndex = Math.max(0, rows.length - 1);
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		const lines = [
			"",
			` ${theme.bold("Undo to message")}`,
			` ${theme.fg("muted", "Turns after the selected message are undone; you can restore files next.")}`,
			"",
			...this.border.render(width),
			"",
		];

		const start = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE / 2), this.rows.length - MAX_VISIBLE),
		);
		const end = Math.min(start + MAX_VISIBLE, this.rows.length);
		for (let i = start; i < end; i++) {
			const row = this.rows[i];
			const selected = i === this.selectedIndex;
			const text = truncateToWidth(row.text.replace(/\n/g, " ").trim(), width - 2);
			lines.push((selected ? theme.fg("accent", "› ") : "  ") + (selected ? theme.bold(text) : text));
			const time = new Date(row.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
			const files = row.files === 0 ? "no file changes" : `${row.files} file${row.files === 1 ? "" : "s"} changed`;
			lines.push(theme.fg("muted", `  ${time} · ${files}${row.shellRan ? " · shell ran" : ""}`));
			lines.push("");
		}
		if (start > 0 || end < this.rows.length) {
			lines.push(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.rows.length})`));
		}

		lines.push("", ...this.border.render(width));
		return lines;
	}

	handleInput(data: string): void {
		const last = this.rows.length - 1;
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? last : this.selectedIndex - 1;
		} else if (this.keybindings.matches(data, "tui.select.down")) {
			this.selectedIndex = this.selectedIndex === last ? 0 : this.selectedIndex + 1;
		} else if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.done(this.rows[this.selectedIndex]?.id);
		} else if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done(undefined);
		}
	}
}
