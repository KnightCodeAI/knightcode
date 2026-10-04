import type { TextContent } from "@knightcode/ai";
import type { Component } from "@knightcode/tui";
import { Container, Markdown, type MarkdownTheme, Spacer } from "@knightcode/tui";
import type { MessageRenderer } from "../../../core/extensions/types.ts";
import type { CustomMessage } from "../../../core/messages.ts";
import { formatToolCall } from "../../../core/tools/render-utils.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { callBlock } from "./call-block.ts";

/**
 * Component that renders a custom message entry from extensions. Without a custom renderer it is drawn like a
 * tool call: `● customType` with the message text on the `⎿` gutter under it.
 */
export class CustomMessageComponent extends Container {
	private message: CustomMessage<unknown>;
	private customRenderer?: MessageRenderer;
	private defaultComponent?: Component;
	private customComponent?: Component;
	private markdownTheme: MarkdownTheme;
	private _expanded = false;
	private outputPad: number;

	constructor(
		message: CustomMessage<unknown>,
		customRenderer?: MessageRenderer,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
	) {
		super();
		this.message = message;
		this.customRenderer = customRenderer;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;

		this.addChild(new Spacer(1));

		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	setOutputPad(outputPad: number): void {
		if (this.outputPad !== outputPad) {
			this.outputPad = outputPad;
			this.rebuild();
		}
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private rebuild(): void {
		// Remove previous content component
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		if (this.defaultComponent) {
			this.removeChild(this.defaultComponent);
			this.defaultComponent = undefined;
		}

		// Try custom renderer first - it handles its own styling
		if (this.customRenderer) {
			try {
				const component = this.customRenderer(
					this.message,
					{ expanded: this._expanded, outputPad: this.outputPad },
					theme,
				);
				if (component) {
					// Custom renderer provides its own styled component
					this.customComponent = component;
					this.addChild(component);
					return;
				}
			} catch {
				// Fall through to default rendering
			}
		}

		let text: string;
		if (typeof this.message.content === "string") {
			text = this.message.content;
		} else {
			text = this.message.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		}

		this.defaultComponent = callBlock(
			formatToolCall(theme, this.message.customType),
			new Markdown(text, 0, 0, this.markdownTheme, {
				color: (text: string) => theme.fg("toolOutput", text),
			}),
		);
		this.addChild(this.defaultComponent);
	}
}
