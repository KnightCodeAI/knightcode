import { type Component, Loader, mixColors, type TUI, truncateToWidth } from "@knightcode/tui";
import type { WorkingIndicatorOptions } from "../../../core/extensions/index.ts";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { keyText } from "./keybinding-hints.ts";

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
	}

	renderInBorder(width: number): string {
		const line = super.render(width + 2)[1] ?? "";
		return truncateToWidth(line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd(), width, "");
	}

	renderSpinnerInBorder(width: number): string {
		return truncateToWidth(this.getRenderedIndicator(), width, "");
	}

	dispose(): void {
		this.stop();
	}
}

/** Milliseconds per glimmer step; matches the default spinner frame, so the glimmer moves one column per frame. */
const GLIMMER_STEP_MS = 80;

/** How far the working indicator moves from the accent toward the text colour. */
const WORKING_SOFTEN = 0.2;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * A three-column highlight sweeping across the text, recomputed from the clock on every spinner frame. The sweep
 * starts and ends ten columns off-screen so it pauses between passes. Pre-styled text is left alone: splitting
 * it would cut its escape sequences.
 */
export function glimmer(
	text: string,
	base: (text: string) => string,
	shine: (text: string) => string,
	now = Date.now(),
): string {
	// Graphemes, not code points, so a highlight edge never splits an emoji or a combining sequence.
	const chars = Array.from(graphemes.segment(text), ({ segment }) => segment);
	if (chars.length === 0 || text.includes("\x1b")) return base(text);
	const center = (Math.floor(now / GLIMMER_STEP_MS) % (chars.length + 20)) - 10;
	const start = Math.min(chars.length, Math.max(0, center - 1));
	const end = Math.min(chars.length, Math.max(0, center + 2));
	const style = (part: string, color: (text: string) => string) => (part ? color(part) : "");
	return (
		style(chars.slice(0, start).join(""), base) +
		style(chars.slice(start, end).join(""), shine) +
		style(chars.slice(end).join(""), base)
	);
}

export class WorkingStatusIndicator extends StatusIndicator {
	/** Accent softened slightly toward the text colour, with a text-coloured shimmer, in the border and on its own row. */
	constructor(ui: TUI, message: string, indicator?: WorkingIndicatorOptions) {
		const working = (text: string) =>
			theme.style(text, { fg: mixColors(theme.colors.accent, theme.colors.text, WORKING_SOFTEN) });
		super(
			"working",
			ui,
			working,
			(text) => glimmer(text, working, (value) => theme.fg("text", value)),
			message,
			indicator,
		);
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		const emptyLine = " ".repeat(width);
		return [emptyLine, emptyLine];
	}
}
