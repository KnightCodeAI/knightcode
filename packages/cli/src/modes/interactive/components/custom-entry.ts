import type { Component } from "@knightcode/tui";
import { Container, Spacer, Text } from "@knightcode/tui";
import type { EntryRenderer } from "../../../core/extensions/types.ts";
import type { CustomEntry } from "../../../core/session-manager.ts";
import { formatToolCall } from "../../../core/tools/render-utils.ts";
import { theme } from "../theme/theme.ts";
import { callBlock } from "./call-block.ts";

/**
 * Component that renders a custom session entry from extensions.
 * The host owns transcript spacing; renderer output should provide only its content.
 */
export class CustomEntryComponent extends Container {
	private entry: CustomEntry<unknown>;
	private renderer: EntryRenderer;
	private customComponent?: Component;
	private _expanded = false;

	constructor(entry: CustomEntry<unknown>, renderer: EntryRenderer) {
		super();
		this.entry = entry;
		this.renderer = renderer;
		this.rebuild();
	}

	hasContent(): boolean {
		return this.customComponent !== undefined;
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		this.customComponent = undefined;

		let component: Component | undefined;
		try {
			component = this.renderer(this.entry, { expanded: this._expanded }, theme);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			component = callBlock(
				formatToolCall(theme, this.entry.customType),
				new Text(theme.fg("error", `Renderer failed: ${message}`), 0, 0),
				"error",
			);
		}

		if (!component) {
			return;
		}

		this.customComponent = component;
		this.addChild(new Spacer(1));
		this.addChild(component);
	}
}
