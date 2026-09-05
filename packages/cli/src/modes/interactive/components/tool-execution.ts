import type { AgentToolResult } from "@knightcode/agent";
import {
	type Component,
	Container,
	getCapabilities,
	Gutter,
	Image,
	MouseRegion,
	Spacer,
	Text,
	type TUI,
	type TuiMouseEvent,
} from "@knightcode/tui";
import type { ToolDefinition, ToolRenderContext, ToolRenderResultOptions } from "../../../core/extensions/types.ts";
import { getTextOutput as getRenderedTextOutput, plural } from "../../../core/tools/render-utils.ts";
import { convertToPng } from "../../../utils/image-convert.ts";
import { BLOCK_INDENT, BULLET, RESULT_GUTTER, RESULT_INDENT } from "../glyphs.ts";
import { theme, type Theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";

/**
 * What this component needs from a tool: how to draw it. It neither executes tools nor reads their
 * parameter schemas, so a definition and a bare renderer pair are equally acceptable.
 *
 * The renderer parameters are `any` on purpose: a `ToolDefinition` types them from its schema, and
 * narrowing them here would make those definitions unassignable.
 */
export interface ToolRenderers {
	renderShell?: "default" | "self";
	renderCall?: (args: any, theme: Theme, context: ToolRenderContext<any, any>) => Component;
	renderResult?: (
		result: AgentToolResult<any>,
		options: ToolRenderResultOptions,
		theme: Theme,
		context: ToolRenderContext<any, any>,
	) => Component;
}

const FALLBACK_PREVIEW_LINES = 10;
const MAX_INLINE_ARGS_LENGTH = 200;

export interface ToolExecutionOptions {
	showImages?: boolean;
	imageWidthCells?: number;
}

/** Single-line, parenthesised argument summary for tools with no custom renderer. */
function formatInlineArgs(args: unknown): string {
	if (args === undefined || args === null) return "";
	if (typeof args === "object" && Object.keys(args as object).length === 0) return "";
	let text: string;
	try {
		text = JSON.stringify(args) ?? "";
	} catch {
		return "";
	}
	if (!text) return "";
	text = text.replace(/\s+/g, " ");
	if (text.length > MAX_INLINE_ARGS_LENGTH) {
		text = `${text.slice(0, MAX_INLINE_ARGS_LENGTH - 1)}…`;
	}
	return text;
}

export class ToolExecutionComponent extends Container {
	private callContainer: Container;
	private resultContainer: Container;
	private callGutter: Gutter;
	private resultGutter: Gutter;
	private selfRenderContainer: Container;
	private selfRenderHeight = 0;
	private callRendererComponent?: Component;
	private resultRendererComponent?: Component;
	private rendererState: any = {};
	private imageComponents: Image[] = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolCallId: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private imageWidthCells: number;
	private isPartial = true;
	private toolDefinition?: ToolRenderers;
	private ui: TUI;
	private cwd: string;
	private executionStarted = false;
	private argsComplete = false;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
	};
	private convertedImages: Map<number, { sourceData: string; sourceMimeType: string; data: string; mimeType: string }> =
		new Map();
	private hideComponent = false;

	constructor(
		toolName: string,
		toolCallId: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolRenderers | ToolDefinition<any, any, any> | undefined,
		ui: TUI,
		cwd: string,
	) {
		super();
		this.toolName = toolName;
		this.toolCallId = toolCallId;
		this.args = args;
		this.toolDefinition = toolDefinition;
		this.showImages = options.showImages ?? true;
		this.imageWidthCells = options.imageWidthCells ?? 60;
		this.ui = ui;
		this.cwd = cwd;

		this.addChild(new Spacer(1));

		// Default shell: the call renders behind a status bullet, the result behind an
		// indented continuation marker. Tools declaring renderShell "self" draw their
		// own framing and get neither.
		this.callContainer = new Container();
		this.resultContainer = new Container();
		this.callGutter = new Gutter(this.callContainer, this.bulletGutter(), BLOCK_INDENT);
		this.resultGutter = new Gutter(this.resultContainer, theme.fg("dim", RESULT_GUTTER), RESULT_INDENT);
		this.selfRenderContainer = new Container();

		if (this.getRenderShell() === "self") {
			this.addChild(this.selfRenderContainer);
		} else {
			this.addChild(this.callGutter);
			this.addChild(this.resultGutter);
		}

		this.updateDisplay();
	}

	private getCallRenderer(): ToolDefinition<any, any>["renderCall"] | undefined {
		return this.toolDefinition?.renderCall;
	}

	private getResultRenderer(): ToolDefinition<any, any>["renderResult"] | undefined {
		return this.toolDefinition?.renderResult;
	}

	private getRenderShell(): "default" | "self" {
		return this.toolDefinition?.renderShell ?? "default";
	}

	/**
	 * Status bullet. Its colour carries what the tinted background block used to:
	 * queued / streaming args, executing, succeeded, failed.
	 */
	private bulletGutter(): string {
		let colorKey: "dim" | "accent" | "success" | "error";
		if (this.result) {
			colorKey = this.result.isError ? "error" : this.isPartial ? "accent" : "success";
		} else if (this.executionStarted) {
			colorKey = "accent";
		} else {
			colorKey = "dim";
		}
		return `${theme.fg(colorKey, BULLET)} `;
	}

	private getRenderContext(lastComponent: Component | undefined): ToolRenderContext {
		return {
			args: this.args,
			toolCallId: this.toolCallId,
			invalidate: () => {
				this.invalidate();
				this.ui.requestRender();
			},
			lastComponent,
			state: this.rendererState,
			cwd: this.cwd,
			executionStarted: this.executionStarted,
			argsComplete: this.argsComplete,
			isPartial: this.isPartial,
			expanded: this.expanded,
			showImages: this.showImages,
			isError: this.result?.isError ?? false,
		};
	}

	private createCallFallback(): Component {
		const inlineArgs = formatInlineArgs(this.args);
		const title = theme.fg("toolTitle", theme.bold(this.toolName));
		return new Text(inlineArgs ? `${title}(${theme.fg("muted", inlineArgs)})` : title, 0, 0);
	}

	private createResultFallback(): Component | undefined {
		const output = this.getTextOutput();
		if (!output) {
			return undefined;
		}

		const lines = output.split("\n");
		const displayLines = this.expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
		const remaining = lines.length - displayLines.length;
		let text = displayLines.map((line) => theme.fg("toolOutput", line)).join("\n");
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${plural(remaining, "more line")},`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
		return new Text(text, 0, 0);
	}

	private createResultRegion(component: Component): MouseRegion {
		return new MouseRegion(component, (event) => {
			if (!this.result || event.type !== "click" || event.button !== "left") return undefined;
			this.setExpanded(!this.expanded);
			return { handled: true };
		});
	}

	updateArgs(args: any): void {
		this.args = args;
		this.updateDisplay();
	}

	markExecutionStarted(): void {
		this.executionStarted = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	setArgsComplete(): void {
		this.argsComplete = true;
		this.updateDisplay();
		this.ui.requestRender();
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError: boolean;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		this.updateDisplay();
		this.maybeConvertImagesForKitty();
	}

	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content.filter((c) => c.type === "image");
		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			const sourceData = img.data;
			const sourceMimeType = img.mimeType;
			if (sourceMimeType === "image/png") continue;
			const cached = this.convertedImages.get(i);
			if (cached?.sourceData === sourceData && cached.sourceMimeType === sourceMimeType) continue;

			const index = i;
			convertToPng(sourceData, sourceMimeType).then((converted) => {
				const currentImage = this.result?.content.filter((content) => content.type === "image")[index];
				if (!converted || currentImage?.data !== sourceData || currentImage.mimeType !== sourceMimeType) return;
				this.convertedImages.set(index, {
					sourceData,
					sourceMimeType,
					...converted,
				});
				this.updateDisplay();
				this.ui.requestRender();
			});
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
	}

	setImageWidthCells(width: number): void {
		this.imageWidthCells = Math.max(1, Math.floor(width));
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	override render(width: number): string[] {
		if (this.hideComponent) {
			return [];
		}

		if (this.getRenderShell() === "self") {
			const contentLines = this.selfRenderContainer.render(width);
			this.selfRenderHeight = contentLines.length;
			if (contentLines.length === 0 && this.imageComponents.length === 0) {
				return [];
			}

			const lines: string[] = [];
			if (contentLines.length > 0) {
				lines.push("");
				lines.push(...contentLines);
			}
			for (let i = 0; i < this.imageComponents.length; i++) {
				const spacer = this.imageSpacers[i];
				if (spacer) {
					lines.push(...spacer.render(width));
				}
				const imageComponent = this.imageComponents[i];
				if (imageComponent) {
					lines.push(...imageComponent.render(width));
				}
			}
			return lines;
		}

		return super.render(width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		if (this.getRenderShell() !== "self") return super.handleMouse(event);
		if (event.y <= 0 || event.y > this.selfRenderHeight) return undefined;
		return this.selfRenderContainer.handleMouse({
			...event,
			y: event.y - 1,
			height: this.selfRenderHeight,
		});
	}

	private updateDisplay(): void {
		const selfShell = this.getRenderShell() === "self";
		let hasContent = false;
		this.hideComponent = false;

		this.callGutter.setPrefixes(this.bulletGutter(), BLOCK_INDENT);

		const callTarget = selfShell ? this.selfRenderContainer : this.callContainer;
		const resultTarget = selfShell ? this.selfRenderContainer : this.resultContainer;
		callTarget.clear();
		if (!selfShell) {
			resultTarget.clear();
		}

		const callRenderer = this.getCallRenderer();
		if (!callRenderer) {
			callTarget.addChild(this.createResultRegion(this.createCallFallback()));
			hasContent = true;
		} else {
			try {
				const component = callRenderer(this.args, theme, this.getRenderContext(this.callRendererComponent));
				this.callRendererComponent = component;
				callTarget.addChild(this.createResultRegion(component));
				hasContent = true;
			} catch {
				this.callRendererComponent = undefined;
				callTarget.addChild(this.createResultRegion(this.createCallFallback()));
				hasContent = true;
			}
		}

		if (this.result) {
			const resultRenderer = this.getResultRenderer();
			if (!resultRenderer) {
				const component = this.createResultFallback();
				if (component) {
					resultTarget.addChild(this.createResultRegion(component));
					hasContent = true;
				}
			} else {
				try {
					const component = resultRenderer(
						{ content: this.result.content as any, details: this.result.details },
						{ expanded: this.expanded, isPartial: this.isPartial },
						theme,
						this.getRenderContext(this.resultRendererComponent),
					);
					this.resultRendererComponent = component;
					resultTarget.addChild(this.createResultRegion(component));
					hasContent = true;
				} catch {
					this.resultRendererComponent = undefined;
					const component = this.createResultFallback();
					if (component) {
						resultTarget.addChild(this.createResultRegion(component));
						hasContent = true;
					}
				}
			}
		}

		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result) {
			const imageBlocks = this.result.content.filter((c) => c.type === "image");
			const caps = getCapabilities();
			for (let i = 0; i < imageBlocks.length; i++) {
				const img = imageBlocks[i];
				if (caps.images && this.showImages && img.data && img.mimeType) {
					const cached = this.convertedImages.get(i);
					const converted =
						cached?.sourceData === img.data && cached.sourceMimeType === img.mimeType ? cached : undefined;
					const imageData = converted?.data ?? img.data;
					const imageMimeType = converted?.mimeType ?? img.mimeType;
					if (caps.images === "kitty" && imageMimeType !== "image/png") continue;

					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.imageSpacers.push(spacer);
					const imageComponent = new Image(
						imageData,
						imageMimeType,
						{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
						{ maxWidthCells: this.imageWidthCells },
					);
					this.imageComponents.push(imageComponent);
					this.addChild(imageComponent);
				}
			}
		}

		if (!hasContent && this.imageComponents.length === 0) {
			this.hideComponent = true;
		}
	}

	private getTextOutput(): string {
		return getRenderedTextOutput(this.result, this.showImages);
	}
}
