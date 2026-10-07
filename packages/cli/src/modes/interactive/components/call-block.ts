import {
	type Component,
	Container,
	Gutter,
	Markdown,
	type MarkdownTheme,
	MouseRegion,
	Text,
	truncateToWidth,
	type TuiMouseEvent,
	visibleWidth,
} from "@knightcode/tui";
import { formatToolCall, formatToolSummary, plural } from "../../../core/tools/render-utils.ts";
import { BLOCK_INDENT, BULLET_GUTTER, RESULT_GUTTER, RESULT_INDENT } from "../glyphs.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const IMAGE_LINE = /\x1b_G|\x1b]1337;File=/;

/** Shift transcript lines right, keeping them inside `width`. Blank lines and inline images stay put. */
export function prefixOutputPad(lines: string[], outputPad: number, width = Number.POSITIVE_INFINITY): string[] {
	if (outputPad <= 0) return lines;
	const prefix = " ".repeat(outputPad);
	return lines.map((line) => {
		if (line.length === 0 || IMAGE_LINE.test(line)) return line;
		const padded = prefix + line;
		return visibleWidth(padded) > width ? truncateToWidth(padded, width, "") : padded;
	});
}

/** The pointer in the unpadded content, or undefined when it lands in the pad. */
export function paddedMouseEvent(event: TuiMouseEvent, outputPad: number): TuiMouseEvent | undefined {
	const pad = Math.max(0, outputPad);
	if (pad > 0 && event.x < pad) return undefined;
	return { ...event, x: event.x - pad, width: Math.max(1, event.width - pad) };
}

/** `● call` with `result` hung under it on the `⎿` gutter: the shape of a finished tool call. */
export function callBlock(call: string, result: Component, bullet: "success" | "error" = "success"): Container {
	const block = new Container();
	block.addChild(new Gutter(new Text(call, 0, 0), theme.fg(bullet, BULLET_GUTTER), BLOCK_INDENT));
	block.addChild(new Gutter(result, theme.fg("dim", RESULT_GUTTER), RESULT_INDENT));
	return block;
}

/** `Loaded · 42 lines`: a summary verb followed by the body's line count. */
export function countedSummary(verb: string, body: string): string {
	const text = body.trimEnd();
	return `${verb} · ${plural(text ? text.split("\n").length : 0, "line")}`;
}

/**
 * A transcript event that is not a tool call but reads as one: `● Name(arg)`, then `⎿  summary`, then the
 * markdown body when expanded. A left click toggles it.
 */
export class CollapsibleCallComponent extends Container {
	private expanded = false;
	private name: string;
	private arg: string | undefined;
	private summary: string;
	private body: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;

	constructor(
		name: string,
		arg: string | undefined,
		summary: string,
		body: string,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
	) {
		super();
		this.name = name;
		this.arg = arg;
		this.summary = summary;
		this.body = body;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setOutputPad(outputPad: number): void {
		this.outputPad = outputPad;
	}

	override render(width: number): string[] {
		const pad = Math.max(0, this.outputPad);
		return prefixOutputPad(super.render(Math.max(1, width - pad)), pad, width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		const next = paddedMouseEvent(event, this.outputPad);
		if (!next) return undefined;
		return super.handleMouse(next);
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();
		const result = new Container();
		result.addChild(new Text(formatToolSummary(theme, this.summary, !this.expanded), 0, 0));
		if (this.expanded) {
			result.addChild(
				new Markdown(this.body, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("toolOutput", text),
				}),
			);
		}
		const call = formatToolCall(theme, this.name, this.arg === undefined ? undefined : theme.fg("accent", this.arg));
		this.addChild(
			new MouseRegion(callBlock(call, result), (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				this.setExpanded(!this.expanded);
				return { handled: true };
			}),
		);
	}
}
