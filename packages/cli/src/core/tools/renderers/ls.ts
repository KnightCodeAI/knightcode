/**
 * Presentation for the ls tool.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `ls.ts` spreads these into its
 * definition, so the tool's public shape is unchanged.
 */

import { Text } from "@knightcode/tui";
import { keyHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { LsToolDetails } from "../ls.ts";
import { formatToolCall, formatToolSummary, getTextOutput, plural, renderToolPath, str } from "../render-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize } from "../truncate.ts";

function formatLsCall(args: { path?: string; limit?: number } | undefined, theme: Theme, cwd: string): string {
	const limit = args?.limit;
	const pathDisplay = renderToolPath(str(args?.path), theme, cwd, { emptyFallback: "." });
	let callArgs = pathDisplay;
	if (limit !== undefined) {
		callArgs += theme.fg("toolOutput", `, limit ${limit}`);
	}
	return formatToolCall(theme, "List", callArgs);
}
function formatLsResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: LsToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	const lines = output ? output.split("\n") : [];
	let text = "";
	const pathCount = result.details?.pathCount ?? lines.length;
	if (!options.expanded) {
		text = formatToolSummary(theme, `Listed ${plural(pathCount, "path")}`, lines.length > 0);
	} else if (lines.length > 0) {
		text = lines.map((line) => theme.fg("toolOutput", line)).join("\n");
	}

	const entryLimit = result.details?.entryLimitReached;
	const truncation = result.details?.truncation;
	if (entryLimit || truncation?.truncated) {
		const warnings: string[] = [];
		if (entryLimit) warnings.push(`${entryLimit} entries limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		text += `${text ? "\n" : ""}${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

export const lsRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatLsCall(args as any, theme, context.cwd));
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatLsResult(result as any, options, theme, context.showImages));
		return text;
	},
};
