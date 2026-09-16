import { Text } from "@knightcode/tui";
import type { Theme, ToolDefinition } from "@knightcodeai/cli";
import { formatToolCall, formatToolSummary, getTextOutput } from "@knightcodeai/cli/core/tools/render-utils";
import { formatSize } from "@knightcodeai/cli/core/tools/truncate";
import type { WebfetchDetails, WebfetchParams } from "./fetch.ts";
import type { WebsearchDetails, WebsearchParams } from "./search.ts";

type Renderers = Pick<ToolDefinition<any, any>, "renderCall" | "renderResult">;
interface RenderableResult<D> {
	content: Array<{ type: string; text?: string }>;
	details?: D;
}

const URL_WIDTH = 80;

function shorten(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function expandedLines(theme: Theme, text: string): string {
	return text
		.split("\n")
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");
}

export function webfetchCallText(args: Partial<WebfetchParams> | undefined, theme: Theme): string {
	const extra =
		args?.grep !== undefined ? `, grep ${args.grep}` : args?.offset !== undefined ? `, offset ${args.offset}` : "";
	const url = theme.fg("accent", shorten(args?.url ?? "", URL_WIDTH));
	return formatToolCall(theme, "webfetch", extra ? `${url}${theme.fg("toolOutput", extra)}` : url);
}

export function webfetchResultText(result: RenderableResult<WebfetchDetails>, expanded: boolean, theme: Theme): string {
	const text = getTextOutput(result, false).trim();
	if (expanded) return expandedLines(theme, text);
	const d = result.details;
	if (!d) return theme.fg("toolOutput", text.split("\n")[0] ?? "");
	const summary =
		d.matches !== undefined
			? `${d.matches} matches of ${d.totalLines} lines`
			: `${formatSize(d.bytes)}, lines ${d.from}-${d.to} of ${d.totalLines}${d.cached ? " (cached)" : ""}`;
	return formatToolSummary(theme, summary, true);
}

export function websearchCallText(args: Partial<WebsearchParams> | undefined, theme: Theme): string {
	return formatToolCall(theme, "websearch", theme.fg("accent", `"${shorten(args?.query ?? "", 60)}"`));
}

export function websearchResultText(
	result: RenderableResult<WebsearchDetails>,
	expanded: boolean,
	theme: Theme,
): string {
	const text = getTextOutput(result, false).trim();
	if (expanded) return expandedLines(theme, text);
	const d = result.details;
	if (!d) return theme.fg("toolOutput", text.split("\n")[0] ?? "");
	return formatToolSummary(theme, `${d.results.length} results (${d.provider})`, true);
}

function textComponent(context: { lastComponent?: unknown }): Text {
	return (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
}

export const webfetchRenderers: Renderers = {
	renderCall(args, theme, context) {
		const text = textComponent(context);
		text.setText(webfetchCallText(args as Partial<WebfetchParams> | undefined, theme));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = textComponent(context);
		text.setText(webfetchResultText(result as RenderableResult<WebfetchDetails>, options.expanded, theme));
		return text;
	},
};

export const websearchRenderers: Renderers = {
	renderCall(args, theme, context) {
		const text = textComponent(context);
		text.setText(websearchCallText(args as Partial<WebsearchParams> | undefined, theme));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = textComponent(context);
		text.setText(websearchResultText(result as RenderableResult<WebsearchDetails>, options.expanded, theme));
		return text;
	},
};
