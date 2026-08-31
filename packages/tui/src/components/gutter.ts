import { isImageLine } from "../terminal-image.ts";
import type { Component } from "../tui.ts";
import { visibleWidth } from "../utils.ts";

/**
 * Gutter component - prefixes every line of a single child with a left gutter.
 *
 * The first rendered line gets `firstPrefix`, every following line gets `restPrefix`.
 * Both prefixes must have the same visible width so the child's wrap width stays
 * constant across the block (that is what keeps `⏺ `/`  ` and `  ⎿  `/`     ` aligned).
 *
 * Image lines pass through unprefixed - terminal image escape sequences must start
 * at the beginning of a line to render.
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

	render(width: number): string[] {
		const contentWidth = Math.max(1, width - this.gutterWidth);
		const childLines = this.child.render(contentWidth);
		if (childLines.length === 0) {
			return [];
		}

		const lines: string[] = [];
		for (let i = 0; i < childLines.length; i++) {
			const line = childLines[i];
			if (isImageLine(line)) {
				lines.push(line);
				continue;
			}
			lines.push((i === 0 ? this.firstPrefix : this.restPrefix) + line);
		}
		return lines;
	}
}
