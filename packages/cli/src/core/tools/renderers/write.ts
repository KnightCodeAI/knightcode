/**
 * Presentation for the write tool.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `write.ts` spreads these into its
 * definition, so the tool's public shape is unchanged.
 *
 * While the call streams, its content previews under the header. Once it lands, the result shows a
 * diff when the write replaced a file, and the numbered content when it created one.
 */

import { Container, Text } from "@knightcode/tui";
import { diffView, LinesView, renderNumberedLines } from "../../../modes/interactive/components/diff.ts";
import { keyHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import { getLanguageFromPath, highlightCode, type Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../../extensions/types.ts";
import type { WriteToolDetails } from "../write.ts";
import {
	formatToolCall,
	normalizeDisplayText,
	plural,
	renderToolPath,
	replaceTabs,
	shortenPath,
	str,
} from "../render-utils.ts";
import { formatDiffSummary } from "./edit.ts";

type WriteArgs = { path?: string; file_path?: string; content?: string } | undefined;
type WriteHighlightCache = {
	rawPath: string | null;
	lang: string | undefined;
	rawContent: string;
	normalizedLines: string[];
	highlightedLines: string[];
};
export type WriteRenderState = { cache?: WriteHighlightCache };

const PREVIEW_LINES = 10;
const WRITE_PARTIAL_FULL_HIGHLIGHT_LINES = 50;

function highlightSingleLine(line: string, lang: string | undefined): string {
	return highlightCode(line, lang)[0] ?? "";
}
function refreshWriteHighlightPrefix(cache: WriteHighlightCache): void {
	const prefixCount = Math.min(WRITE_PARTIAL_FULL_HIGHLIGHT_LINES, cache.normalizedLines.length);
	if (prefixCount === 0) return;
	const prefixSource = cache.normalizedLines.slice(0, prefixCount).join("\n");
	const prefixHighlighted = highlightCode(prefixSource, cache.lang);
	for (let i = 0; i < prefixCount; i++) {
		cache.highlightedLines[i] = prefixHighlighted[i] ?? highlightSingleLine(cache.normalizedLines[i] ?? "", cache.lang);
	}
}
function rebuildWriteHighlightCacheFull(rawPath: string | null, fileContent: string): WriteHighlightCache {
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	const normalized = replaceTabs(normalizeDisplayText(fileContent));
	return {
		rawPath,
		lang,
		rawContent: fileContent,
		normalizedLines: normalized.split("\n"),
		highlightedLines: highlightCode(normalized, lang),
	};
}
/** Highlight only what streamed in since the last call; a full rebuild per delta would be quadratic. */
function updateWriteHighlightCacheIncremental(
	cache: WriteHighlightCache | undefined,
	rawPath: string | null,
	fileContent: string,
): WriteHighlightCache {
	if (!cache || cache.rawPath !== rawPath || !fileContent.startsWith(cache.rawContent)) {
		return rebuildWriteHighlightCacheFull(rawPath, fileContent);
	}
	if (fileContent.length === cache.rawContent.length) return cache;

	const deltaNormalized = replaceTabs(normalizeDisplayText(fileContent.slice(cache.rawContent.length)));
	cache.rawContent = fileContent;
	if (cache.normalizedLines.length === 0) {
		cache.normalizedLines.push("");
		cache.highlightedLines.push("");
	}

	const segments = deltaNormalized.split("\n");
	const lastIndex = cache.normalizedLines.length - 1;
	cache.normalizedLines[lastIndex] += segments[0];
	cache.highlightedLines[lastIndex] = highlightSingleLine(cache.normalizedLines[lastIndex], cache.lang);
	for (let i = 1; i < segments.length; i++) {
		cache.normalizedLines.push(segments[i]);
		cache.highlightedLines.push(highlightSingleLine(segments[i], cache.lang));
	}
	refreshWriteHighlightPrefix(cache);
	return cache;
}
function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}

/** Numbered, highlighted content: the first {@link PREVIEW_LINES} lines unless expanded. */
function addContentPreview(container: Container, cache: WriteHighlightCache, expanded: boolean, theme: Theme): void {
	const lines = cache.highlightedLines.slice(0, trimTrailingEmptyLines(cache.normalizedLines).length);
	const shown = expanded ? lines : lines.slice(0, PREVIEW_LINES);
	if (shown.length === 0) return;
	container.addChild(new LinesView((width) => renderNumberedLines(shown, width)));
	const remaining = lines.length - shown.length;
	if (remaining > 0) {
		container.addChild(
			new Text(
				`${theme.fg("muted", `… +${plural(remaining, "line")} (`)}${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`,
				0,
				0,
			),
		);
	}
}

function errorText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
}

export const writeRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const state = context.state as WriteRenderState;
		const renderArgs = args as WriteArgs;
		const rawPath = str(renderArgs?.file_path ?? renderArgs?.path);
		const fileContent = str(renderArgs?.content);
		if (fileContent) {
			state.cache = context.argsComplete
				? rebuildWriteHighlightCacheFull(rawPath, fileContent)
				: updateWriteHighlightCacheIncremental(state.cache, rawPath, fileContent);
		} else {
			state.cache = undefined;
		}

		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		component.addChild(new Text(formatToolCall(theme, "Write", renderToolPath(rawPath, theme, context.cwd)), 0, 0));
		if (fileContent === null) {
			component.addChild(new Text(theme.fg("error", "[invalid content arg - expected string]"), 0, 0));
		} else if (state.cache && (context.isPartial || context.isError)) {
			// Keep the attempted content visible on failure; on success the result takes over.
			addContentPreview(component, state.cache, context.expanded, theme);
		}
		return component;
	},
	renderResult(result, _options, theme, context) {
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		if (context.isError) {
			const output = errorText(result);
			if (output) component.addChild(new Text(theme.fg("error", output), 0, 0));
			return component;
		}

		const args = context.args as WriteArgs;
		const rawPath = str(args?.file_path ?? args?.path);
		const fileContent = str(args?.content);
		if (rawPath === null || fileContent === null) return component;

		const diff = (result.details as WriteToolDetails | undefined)?.diff;
		if (diff) {
			component.addChild(new Text(formatDiffSummary(diff, theme), 0, 0));
			component.addChild(diffView(diff, { filePath: rawPath }));
			return component;
		}

		const state = context.state as WriteRenderState;
		const cache =
			state.cache?.rawContent === fileContent && state.cache.rawPath === rawPath
				? state.cache
				: rebuildWriteHighlightCacheFull(rawPath, fileContent);
		state.cache = cache;
		const lineCount = trimTrailingEmptyLines(cache.normalizedLines).length;
		component.addChild(
			new Text(
				theme.fg(
					"toolOutput",
					`Wrote ${theme.bold(String(lineCount))} ${lineCount === 1 ? "line" : "lines"} to ${shortenPath(rawPath)}`,
				),
				0,
				0,
			),
		);
		addContentPreview(component, cache, context.expanded, theme);
		return component;
	},
};
