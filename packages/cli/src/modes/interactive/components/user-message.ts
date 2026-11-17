import { Container, Markdown, type MarkdownTheme, visibleWidth } from "@knightcode/tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { USER_GUTTER, USER_INDENT } from "../glyphs.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private messageId?: string;
	private timestamp?: string;
	private zoneLines?: { source: readonly string[]; lines: string[] };

	constructor(
		text: string,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super();
		this.text = text;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.messageId = messageId;
		this.timestamp = timestamp;
		this.rebuild();
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		// The Markdown pads and colors its own background: a Box around it would keep a second full-width copy of every
		// line, with identical output.
		this.addChild(
			new Markdown(
				this.text,
				0,
				0,
				this.markdownTheme,
				{
					color: (content: string) => theme.fg("userMessageText", content),
					bgColor: (content: string) => theme.bg("userMessageBg", content),
				},
				{
					preserveOrderedListMarkers: true,
					preserveBackslashEscapes: true,
					transform: createMarkdownTransform(
						"user",
						() => false,
						this.markdownTransformers,
						this.messageId,
						this.timestamp,
					),
				},
			),
		);
	}

	override render(width: number): readonly string[] {
		// The marker sits in the transcript gutter so the text starts where assistant and tool text do; output padding
		// is the right margin.
		const bg = (content: string) => theme.bg("userMessageBg", content);
		const rightPad = bg(" ".repeat(this.outputPad));
		const lines = super
			.render(Math.max(1, width - visibleWidth(USER_GUTTER) - this.outputPad))
			.map((line, i) => bg(i === 0 ? theme.fg("dim", USER_GUTTER) : USER_INDENT) + line + rightPad);
		if (lines.length === 0) {
			return lines;
		}

		// Container output is shared across frames; copy it once per change instead of mutating it.
		if (this.zoneLines?.source !== lines) {
			const zoned = [...lines];
			zoned[0] = OSC133_ZONE_START + zoned[0];
			zoned[zoned.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + zoned[zoned.length - 1];
			this.zoneLines = { source: lines, lines: zoned };
		}
		return this.zoneLines.lines;
	}
}
