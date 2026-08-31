import { Box, visibleWidth } from "@knightcode/tui";

/**
 * A Box whose whole block hangs off a marker gutter: the marker on the first
 * line, matching blank indent on the rest.
 *
 * The marker is resolved per render so it can follow the active theme.
 */
export class GutteredBox extends Box {
	private marker: () => string;

	constructor(marker: () => string) {
		super(0, 0);
		this.marker = marker;
	}

	override render(width: number): string[] {
		const first = this.marker();
		const gutterWidth = visibleWidth(first);
		const rest = " ".repeat(gutterWidth);
		return super.render(Math.max(1, width - gutterWidth)).map((line, i) => (i === 0 ? first : rest) + line);
	}
}
