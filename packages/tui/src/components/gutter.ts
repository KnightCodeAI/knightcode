import { isImageLine } from "../terminal-image.ts";
import { type Component, dispatchMouseEvent, type TuiMouseDispatchResult, type TuiMouseEvent } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../utils.ts";

/**
 * Gutter component - prefixes every line of a single child with a left gutter.
 *
 * The first rendered line gets `firstPrefix`, every following line gets `restPrefix`.
 * Both prefixes must have the same visible width so the child's wrap width stays
 * constant across the block (that is what keeps `⏺ `/`  ` and `  ⎿  `/`     ` aligned).
 *
 * Image lines get blank padding of the gutter's width instead of the prefix glyphs, and are
 * never truncated: the escape sequence draws at the cursor, so the padding indents the image.
 * On rows narrower than the gutter the padding shrinks so the image still starts on screen.
 */
export class Gutter implements Component {
	private child: Component;
	private firstPrefix: string;
	private restPrefix: string;
	private gutterWidth: number;

	constructor(child: Component, firstPrefix: string, restPrefix: string) {
		this.child = child;
		this.firstPrefix = firstPrefix;
		this.restPrefix = restPrefix;
		this.gutterWidth = visibleWidth(firstPrefix);
	}

	getChild(): Component {
		return this.child;
	}

	/** Update the gutter strings, e.g. to recolor a status bullet. */
	setPrefixes(firstPrefix: string, restPrefix: string): void {
		this.firstPrefix = firstPrefix;
		this.restPrefix = restPrefix;
		this.gutterWidth = visibleWidth(firstPrefix);
	}

	invalidate(): void {
		this.child.invalidate?.();
	}

	/**
	 * Forward mouse events to the child in the child's own coordinates.
	 *
	 * The gutter shifts every content line right by its prefix, so a click lands
	 * `gutterWidth` columns further left inside the child. Clicks on the gutter
	 * itself belong to it, not the child, and are dropped.
	 */
	handleMouse(event: TuiMouseEvent): TuiMouseDispatchResult | undefined {
		if (event.x < this.gutterWidth) return undefined;
		return dispatchMouseEvent(this.child, {
			...event,
			x: event.x - this.gutterWidth,
			width: Math.max(1, event.width - this.gutterWidth),
		});
	}

	render(width: number): string[] {
		const contentWidth = Math.max(1, width - this.gutterWidth);
		// No room left beside the prefix: the child still gets one column, so cut each line back to the width.
		const squeezed = this.gutterWidth + contentWidth > width;
		const childLines = this.child.render(contentWidth);
		if (childLines.length === 0) {
			return [];
		}

		// Capped so the image still starts on screen when the gutter fills the row.
		const imagePad = " ".repeat(Math.max(0, Math.min(this.gutterWidth, width - 1)));
		const lines: string[] = [];
		for (let i = 0; i < childLines.length; i++) {
			const line = childLines[i];
			if (isImageLine(line)) {
				lines.push(imagePad + line);
				continue;
			}
			const prefixed = (i === 0 ? this.firstPrefix : this.restPrefix) + line;
			lines.push(squeezed ? truncateToWidth(prefixed, width, "") : prefixed);
		}
		return lines;
	}
}
