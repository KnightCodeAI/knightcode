import type { Component, TuiMouseEvent } from "@knightcode/tui";
import { Container, Spacer, Text } from "@knightcode/tui";
import type { EntryRenderer } from "../../../core/extensions/types.ts";
import type { CustomEntry } from "../../../core/session-manager.ts";
import { formatToolCall } from "../../../core/tools/render-utils.ts";
import { theme } from "../theme/theme.ts";
import { callBlock, paddedMouseEvent, prefixOutputPad } from "./call-block.ts";

/**
 * Component that renders a custom session entry from extensions.
 * The host owns transcript spacing; renderer output should provide only its content.
 */
export class CustomEntryComponent extends Container {
	private entry: CustomEntry<unknown>;
	private renderer: EntryRenderer;
	private customComponent?: Component;
	private _expanded = false;
	private outputPad: number;
	/** The error fallback is ours to pad. A renderer that returned a component owns its own padding. */
	private padContent = false;

	constructor(entry: CustomEntry<unknown>, renderer: EntryRenderer, outputPad = 1) {
		super();
		this.entry = entry;
		this.renderer = renderer;
		this.outputPad = outputPad;
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

	setOutputPad(outputPad: number): void {
		this.outputPad = outputPad;
	}

	override render(width: number): string[] {
		if (!this.padContent) return super.render(width);
		const pad = Math.max(0, this.outputPad);
		return prefixOutputPad(super.render(Math.max(1, width - pad)), pad, width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		if (!this.padContent) return super.handleMouse(event);
		const next = paddedMouseEvent(event, this.outputPad);
		if (!next) return undefined;
		return super.handleMouse(next);
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		this.customComponent = undefined;

		let component: Component | undefined;
		this.padContent = false;
		try {
			component = this.renderer(this.entry, { expanded: this._expanded }, theme);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.padContent = true;
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
