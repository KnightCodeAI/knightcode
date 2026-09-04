/**
 * Presentation for the shell tools.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `bash.ts` spreads these into the shell
 * tool definition, so the tool's public shape is unchanged.
 */

import { type Component, Container, Text, truncateToWidth, visibleWidth } from "@knightcode/tui";
import { keyHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import { truncateToVisualLines } from "../../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { BashToolDetails } from "../bash.ts";
import { formatToolCall, getTextOutput, invalidArgText, plural, str } from "../render-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize } from "../truncate.ts";

const BASH_PREVIEW_LINES = 5;
export const BASH_UPDATE_THROTTLE_MS = 100;
type BashResultRenderState = {
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	cachedSkipped: number | undefined;
};
class BashResultRenderComponent extends Container {
	state: BashResultRenderState = {
		cachedWidth: undefined,
		cachedLines: undefined,
		cachedSkipped: undefined,
	};
}
function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}
function formatShellCall(
	args: { command?: string; timeout?: number } | undefined,
	displayName: string,
	width: number,
): string {
	const command = str(args?.command);
	const timeout = args?.timeout as number | undefined;
	const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
	// Keep the header on one line. Commands run to hundreds of characters of quoted
	// URL, and wrapping the whole thing buries the rest of the transcript.
	const framing = visibleWidth(displayName) + 2;
	// A fragment of `(timeout 120s)` tells the reader nothing, so the suffix is all or
	// nothing: it survives only while the command still has a column left to live in.
	const suffix = framing + visibleWidth(timeoutSuffix) < width ? timeoutSuffix : "";
	const invalid = command === null;
	const argText = invalid ? invalidArgText(theme) : theme.fg("toolOutput", (command || "...").replace(/\s+/g, " "));
	// truncateToWidth resets the colour before appending its ellipsis, so hand it one
	// already dressed in the branch's own colour rather than the terminal default.
	// Styling before truncating also keeps both branches on one path: at a zero budget
	// each yields "", which formatToolCall renders as a bare title, not empty parens.
	const argEllipsis = theme.fg(invalid ? "error" : "toolOutput", "…");
	const argSummary = truncateToWidth(argText, Math.max(width - framing - visibleWidth(suffix), 0), argEllipsis);
	// The name and parens can still outgrow a very narrow terminal, so clamp the
	// assembled header too - render() emits this line as-is, nothing rewraps it.
	return truncateToWidth(formatToolCall(theme, displayName, argSummary) + suffix, width, "…");
}

/** Renders the `Bash(...)` header, clamped to the available width. */
class ShellCallRenderComponent implements Component {
	args: { command?: string; timeout?: number } | undefined;
	private displayName: string;

	constructor(displayName: string) {
		this.displayName = displayName;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [formatShellCall(this.args, this.displayName, width)];
	}
}
function rebuildBashResultRenderComponent(
	component: BashResultRenderComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
): void {
	const state = component.state;
	component.clear();

	let output = getTextOutput(result as any, showImages).trim();
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (options.expanded) {
			component.addChild(new Text(styledOutput, 0, 0));
		} else {
			component.addChild({
				render: (width: number) => {
					if (state.cachedLines === undefined || state.cachedWidth !== width) {
						const preview = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
						state.cachedLines = preview.visualLines;
						state.cachedSkipped = preview.skippedCount;
						state.cachedWidth = width;
					}
					if (state.cachedSkipped && state.cachedSkipped > 0) {
						const hint =
							theme.fg("muted", `... (${plural(state.cachedSkipped, "earlier line")},`) +
							` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
						return [...(state.cachedLines ?? []), truncateToWidth(hint, width, "...")];
					}
					return [...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	if (truncation?.truncated || fullOutputPath) {
		const warnings: string[] = [];
		if (fullOutputPath) {
			warnings.push(`Full output: ${fullOutputPath}`);
		}
		if (truncation?.truncated) {
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
				);
			}
		}
		component.addChild(new Text(theme.fg("warning", `[${warnings.join(". ")}]`), 0, 0));
	}

	if (startedAt !== undefined) {
		const label = options.isPartial ? "Elapsed" : "Took";
		const endTime = endedAt ?? Date.now();
		component.addChild(new Text(theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`), 0, 0));
	}
}

/** Shell renderers are shared by bash and powershell, which differ only in the name they display. */
export function createShellRenderers(
	displayName: string,
): Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> {
	return {
		renderCall(args, _theme, context) {
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			const component =
				context.lastComponent instanceof ShellCallRenderComponent
					? context.lastComponent
					: new ShellCallRenderComponent(displayName);
			component.args = args as { command?: string; timeout?: number } | undefined;
			return component;
		},
		renderResult(result, options, _theme, context) {
			const state = context.state;
			if (state.startedAt !== undefined && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}
			const component =
				(context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
			rebuildBashResultRenderComponent(
				component,
				result as any,
				options,
				context.showImages,
				state.startedAt,
				state.endedAt,
			);
			component.invalidate();
			return component;
		},
	};
}
