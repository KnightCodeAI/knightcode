import { type Component, Markdown, truncateToWidth } from "@knightcode/tui";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { getMarkdownTheme, type Theme } from "../../modes/interactive/theme/theme.ts";

export type ReviewAction = "implement" | "fresh" | "keep" | "exit";

/** Bounded Markdown review. Page keys scroll the plan; selection keys choose the action. */
export class PlanReviewPicker implements Component {
	private finished = false;
	private readonly done: (action: ReviewAction | undefined) => void;
	private readonly signal: AbortSignal | undefined;
	private readonly onAbort = () => this.finish(undefined);
	private readonly markdown: Markdown;
	private readonly revision: number;
	private readonly contextPercent: number | null;
	private readonly theme: Theme;
	private readonly keys: KeybindingsManager;
	private readonly redraw: () => void;
	private readonly height: () => number;
	private selected = 0;
	private scroll = 0;
	private contentHeight = 0;
	private viewport = 10;

	constructor(
		markdown: string,
		revision: number,
		contextPercent: number | null,
		theme: Theme,
		keys: KeybindingsManager,
		done: (action: ReviewAction | undefined) => void,
		redraw: () => void,
		height: () => number,
		signal?: AbortSignal,
	) {
		this.done = done;
		this.signal = signal;
		if (signal?.aborted) queueMicrotask(this.onAbort);
		else signal?.addEventListener("abort", this.onAbort, { once: true });
		this.markdown = new Markdown(markdown, 0, 0, getMarkdownTheme());
		this.revision = revision;
		this.contextPercent = contextPercent;
		this.theme = theme;
		this.keys = keys;
		this.redraw = redraw;
		this.height = height;
	}

	private finish(action: ReviewAction | undefined): void {
		if (this.finished) return;
		this.finished = true;
		this.done(action);
	}

	dispose(): void {
		this.finished = true;
		this.signal?.removeEventListener("abort", this.onAbort);
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		const content = this.markdown.render(Math.max(1, width));
		this.contentHeight = content.length;
		this.viewport = Math.max(1, this.height() - 10);
		this.scroll = Math.min(this.scroll, Math.max(0, content.length - this.viewport));
		const lines = [
			this.theme.bold(`Plan revision ${this.revision}`),
			"",
			...content.slice(this.scroll, this.scroll + this.viewport),
			this.theme.fg("muted", "Page up/down to scroll the plan"),
			"",
		];
		const labels = [
			"Implement",
			`Implement in a fresh session (${this.contextPercent === null ? "unknown" : Math.round(this.contextPercent) + "%"} context used)`,
			"Keep planning (Esc)",
			"Exit planning",
		];
		for (const [index, label] of labels.entries()) {
			lines.push((index === this.selected ? this.theme.fg("accent", "> ") : "  ") + label);
		}
		return lines.map((line) => truncateToWidth(line, Math.max(1, width)));
	}

	handleInput(data: string): void {
		if (this.finished) return;
		if (this.keys.matches(data, "tui.select.cancel")) this.finish(undefined);
		else if (this.keys.matches(data, "tui.select.up")) this.selected = (this.selected + 3) % 4;
		else if (this.keys.matches(data, "tui.select.down")) this.selected = (this.selected + 1) % 4;
		else if (this.keys.matches(data, "tui.select.pageUp")) this.scroll = Math.max(0, this.scroll - this.viewport);
		else if (this.keys.matches(data, "tui.select.pageDown"))
			this.scroll = Math.min(Math.max(0, this.contentHeight - this.viewport), this.scroll + this.viewport);
		else if (this.keys.matches(data, "tui.select.confirm"))
			this.finish((["implement", "fresh", "keep", "exit"] as const)[this.selected]);
		this.redraw();
	}
}
