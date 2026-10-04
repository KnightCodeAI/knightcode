import { backgroundAnsi, type Component, mixColors, visibleWidth, wrapTextWithAnsi } from "@knightcode/tui";
import * as Diff from "diff";
import { getLanguageFromPath, highlightCode, theme } from "../theme/theme.ts";

/**
 * Diff rows in the layout Claude Code and Codex share:
 *
 * ```
 *  9  context
 * 10 -removed
 * 10 +added
 *    ⋮
 * ```
 *
 * Added and removed rows are tinted to the full width, changed words inside a paired removed/added
 * line get a stronger tint, and added and context rows are syntax highlighted.
 */

const TAB = "    ";
/** Above this share of changed characters a line pair reads as a rewrite, so word emphasis is skipped. */
const WORD_DIFF_MAX_CHANGE = 0.4;
/** How far a row tint moves toward the diff foreground to make the word-emphasis tint. */
const WORD_TINT = 0.3;
const RESET = "\x1b[0m";
const SGR = /\x1b\[[0-9;:]*m/y;

type Kind = "+" | "-" | " ";
type Row = { kind: Kind; lineNum: string; content: string; emphasis: Range[] } | { kind: "skip" };
type Range = { start: number; end: number };

export interface RenderDiffOptions {
	/** Used to pick the syntax highlighting language. */
	filePath?: string;
}

/** Parse a display diff from `generateDiffString` (`+12 text`, `-12 text`, ` 12 text`, `    ...`). */
function parseRows(diffText: string): Row[] {
	const rows: Row[] = [];
	for (const line of diffText.split("\n")) {
		const match = line.match(/^([+\- ])( *\d*) (.*)$/);
		if (!match || (match[1] === " " && !match[2].trim() && match[3] === "...")) {
			rows.push({ kind: "skip" });
			continue;
		}
		rows.push({
			kind: match[1] as Kind,
			lineNum: match[2].trim(),
			content: match[3].replace(/\t/g, TAB),
			emphasis: [],
		});
	}
	return rows;
}

/** Character ranges that differ between two lines, or none when most of the line changed. */
function wordRanges(oldText: string, newText: string): [Range[], Range[]] {
	const oldRanges: Range[] = [];
	const newRanges: Range[] = [];
	let oldOffset = 0;
	let newOffset = 0;
	let changed = 0;
	for (const part of Diff.diffWordsWithSpace(oldText, newText)) {
		const length = part.value.length;
		if (part.removed) {
			oldRanges.push({ start: oldOffset, end: oldOffset + length });
			oldOffset += length;
			changed += length;
		} else if (part.added) {
			newRanges.push({ start: newOffset, end: newOffset + length });
			newOffset += length;
			changed += length;
		} else {
			oldOffset += length;
			newOffset += length;
		}
	}
	const total = oldText.length + newText.length;
	return total > 0 && changed / total > WORD_DIFF_MAX_CHANGE ? [[], []] : [oldRanges, newRanges];
}

/** Pair each run of removed rows with the added run after it, line by line, and mark changed words. */
function markWordChanges(rows: Row[]): void {
	let i = 0;
	while (i < rows.length) {
		if (rows[i].kind !== "-") {
			i++;
			continue;
		}
		const removedStart = i;
		while (i < rows.length && rows[i].kind === "-") i++;
		const addedStart = i;
		while (i < rows.length && rows[i].kind === "+") i++;
		const pairs = Math.min(addedStart - removedStart, i - addedStart);
		for (let k = 0; k < pairs; k++) {
			const removed = rows[removedStart + k];
			const added = rows[addedStart + k];
			if (removed.kind === "skip" || added.kind === "skip") continue;
			[removed.emphasis, added.emphasis] = wordRanges(removed.content, added.content);
		}
	}
}

/**
 * Insert `on` before and `off` after each range of visible characters in an SGR-styled string.
 * Offsets count the characters of the unstyled text.
 */
function emphasize(styled: string, ranges: Range[], on: string, off: string): string {
	if (ranges.length === 0) return styled;
	let out = "";
	let offset = 0;
	let rangeIndex = 0;
	let i = 0;
	while (i < styled.length) {
		SGR.lastIndex = i;
		const sgr = SGR.exec(styled);
		if (sgr) {
			out += sgr[0];
			i += sgr[0].length;
			continue;
		}
		const range = ranges[rangeIndex];
		if (range && offset === range.start) out += on;
		out += styled[i];
		offset++;
		i++;
		if (range && offset === range.end) {
			out += off;
			rangeIndex++;
		}
	}
	return out;
}

function highlightLine(content: string, lang: string | undefined, fallback: Kind): string {
	if (lang) return highlightCode(content, lang)[0] ?? content;
	return theme.fg(fallback === "+" ? "toolDiffAdded" : "toolDiffContext", content);
}

/**
 * Lay out one row: `gutter` on the first physical line, blank space of the same width on wrapped
 * continuations. With `bg`, every physical line is tinted to the full width.
 */
function layoutRow(gutter: string, content: string, width: number, bg?: string): string[] {
	const gutterWidth = visibleWidth(gutter);
	const contentWidth = Math.max(1, width - gutterWidth);
	const pieces = wrapTextWithAnsi(bg ? bg + content : content, contentWidth);
	return pieces.map((piece, index) => {
		const line = (index === 0 ? gutter : " ".repeat(gutterWidth)) + piece;
		if (!bg) return line;
		// Re-open the tint before padding: the piece may have closed it.
		const pad = " ".repeat(Math.max(0, width - gutterWidth - visibleWidth(piece)));
		return `${bg}${line}${bg}${pad}${RESET}`;
	});
}

/** Render a display diff from `generateDiffString` to lines of exactly `width` columns or fewer. */
export function renderDiff(diffText: string, width: number, options: RenderDiffOptions = {}): string[] {
	const rows = parseRows(diffText);
	markWordChanges(rows);
	const lang = options.filePath ? getLanguageFromPath(options.filePath) : undefined;
	const digits = Math.max(1, ...rows.map((row) => (row.kind === "skip" ? 0 : row.lineNum.length)));

	const mode = theme.getColorMode();
	const colors = theme.colors;
	const tint = {
		"+": theme.getBgAnsi("toolSuccessBg"),
		"-": theme.getBgAnsi("toolErrorBg"),
	};
	const wordTint = {
		"+": backgroundAnsi(mixColors(colors.toolSuccessBg, colors.toolDiffAdded, WORD_TINT), mode),
		"-": backgroundAnsi(mixColors(colors.toolErrorBg, colors.toolDiffRemoved, WORD_TINT), mode),
	};

	const out: string[] = [];
	for (const row of rows) {
		if (row.kind === "skip") {
			out.push(`${" ".repeat(digits + 1)}${theme.fg("dim", "⋮")}`);
			continue;
		}
		const number = row.lineNum.padStart(digits);
		if (row.kind === " ") {
			out.push(...layoutRow(`${theme.fg("dim", number)}  `, highlightLine(row.content, lang, " "), width));
			continue;
		}
		const sign = row.kind;
		const color = sign === "+" ? "toolDiffAdded" : "toolDiffRemoved";
		// Removed code stays unhighlighted so the eye lands on what replaced it.
		const content = sign === "+" ? highlightLine(row.content, lang, "+") : theme.fg("toolDiffRemoved", row.content);
		const gutter = theme.fg(color, `${number} ${sign}`);
		out.push(...layoutRow(gutter, emphasize(content, row.emphasis, wordTint[sign], tint[sign]), width, tint[sign]));
	}
	return out;
}

/**
 * Number pre-highlighted file lines, the way a created file is previewed: a dim right-aligned line
 * number, then the code, wrapped under itself.
 */
export function renderNumberedLines(lines: readonly string[], width: number, firstLine = 1): string[] {
	const digits = String(firstLine + lines.length - 1).length;
	return lines.flatMap((line, index) =>
		layoutRow(`${theme.fg("dim", String(firstLine + index).padStart(digits))}  `, line, width),
	);
}

/** A component that renders lines for a width on demand, caching the last result. */
export class LinesView implements Component {
	private renderLines: (width: number) => string[];
	private cache?: { width: number; lines: string[] };

	constructor(renderLines: (width: number) => string[]) {
		this.renderLines = renderLines;
	}

	render(width: number): string[] {
		if (this.cache?.width !== width) this.cache = { width, lines: this.renderLines(width) };
		return this.cache.lines;
	}

	invalidate(): void {
		this.cache = undefined;
	}
}

/** A component that renders a display diff. */
export function diffView(diffText: string, options: RenderDiffOptions = {}): LinesView {
	return new LinesView((width) => renderDiff(diffText, width, options));
}
