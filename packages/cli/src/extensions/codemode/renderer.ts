/**
 * Presentation for codemode: a compact script header and nested calls using the regular tool
 * headers. Expanding reveals the source, arguments and errors. Model-facing output stays intact.
 */

import { type Component, Container, Spacer, Text, truncateToWidth, visibleWidth } from "@knightcode/tui";
import type { TSchema } from "typebox";
import type { ToolDefinition, ToolRenderContext } from "../../core/extensions/types.ts";
import {
	formatToolCall,
	formatToolCallWithArgs,
	formatToolSummary,
	getTextOutput,
	linkPath,
	plural,
	renderToolPath,
	replaceTabs,
	shortenPath,
	startToolTimer,
	str,
	toolTimerText,
} from "../../core/tools/render-utils.ts";
import { createAllToolRenderers } from "../../core/tools/renderers/index.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { VisualLinePreview, expandHint } from "../../modes/interactive/components/visual-truncate.ts";
import { CodeHighlighter, type Theme } from "../../modes/interactive/theme/theme.ts";
import { getCwdRelativePath } from "../../utils/paths.ts";
import type { CodemodeNestedCall, CodemodeToolDetails } from "./tool.ts";

const CALL_PREVIEW_COUNT = 8;
const OUTPUT_PREVIEW_LINES = 5;
const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/;
const OUTPUT_TRUNCATION_HEADER =
	/^Warning: truncated output \(original token count: \d+\)\nTotal output lines: \d+\n\n/;
const BUILT_IN_RENDERERS = createAllToolRenderers();

interface CodemodeRenderState {
	scriptHighlighter?: CodeHighlighter;
}

function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Cents for larger amounts, two significant digits for fractions of a cent. */
function formatCost(cost: number): string {
	return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

function statusIcon(call: CodemodeNestedCall, theme: Theme): string {
	switch (call.status) {
		case "running":
			return theme.fg("warning", "…");
		case "ok":
			return theme.fg("success", "✓");
		case "error":
			return theme.fg("error", "✗");
		case "cancelled":
			return theme.fg("muted", "⊘");
	}
}

function nestedCallHeader(call: CodemodeNestedCall, theme: Theme, context: ToolRenderContext): Component {
	let args: unknown;
	try {
		// Stored arguments are bounded previews and may end in the middle of JSON.
		args = JSON.parse(call.args);
	} catch {
		return new Text(formatToolCall(theme, call.name, theme.fg("muted", replaceTabs(call.args))), 0, 0);
	}
	if (typeof args === "object" && args !== null && !Array.isArray(args)) {
		const displayArgs: Record<string, unknown> = { ...args };
		for (const key of ["path", "file_path"]) {
			const path = displayArgs[key];
			if (typeof path === "string") displayArgs[key] = getCwdRelativePath(path, context.cwd) ?? path;
		}
		// Full Write/Edit renderers own content highlighting and filesystem diff preflight.
		// Nested rows only need their path header, even when the call or script failed.
		if (call.name === "write" || call.name === "edit") {
			const path = renderToolPath(str(displayArgs.file_path ?? displayArgs.path), theme, context.cwd);
			return new Text(formatToolCall(theme, call.name === "write" ? "Write" : "Update", path), 0, 0);
		}
		const renderer = Object.hasOwn(BUILT_IN_RENDERERS, call.name)
			? BUILT_IN_RENDERERS[call.name as keyof typeof BUILT_IN_RENDERERS].renderCall
			: undefined;
		if (renderer) {
			return renderer(displayArgs, theme, {
				args: displayArgs,
				toolCallId: call.id,
				invalidate: context.invalidate,
				state: {},
				lastComponent: undefined,
				cwd: context.cwd,
				// Stored arguments are snapshots; rendering a header must not start execution.
				executionStarted: false,
				argsComplete: true,
				isPartial: false,
				expanded: false,
				showImages: context.showImages,
				isError: call.status === "error",
				durationMs: call.durationMs,
				outputPad: context.outputPad,
				keyText: context.keyText,
				keyHint: context.keyHint,
			});
		}
	}
	return new Text(formatToolCallWithArgs(call.name, args, theme, false), 0, 0);
}

/** Keep status and timing visible while long arguments yield to the terminal width. */
function nestedCallRow(call: CodemodeNestedCall, theme: Theme, context: ToolRenderContext): Component {
	const header = nestedCallHeader(call, theme, context);
	const metadata = [formatDuration(call.durationMs), call.cost ? formatCost(call.cost) : ""]
		.filter(Boolean)
		.join(" · ");
	return {
		render(width) {
			const suffix = metadata && width > visibleWidth(metadata) + 16 ? theme.fg("dim", metadata) : "";
			const headerWidth = Math.max(1, width - 2 - (suffix ? visibleWidth(suffix) + 2 : 0));
			const lines = header.render(headerWidth);
			const firstLine = lines[0] ?? "";
			const label =
				lines.length > 1
					? `${truncateToWidth(firstLine, Math.max(0, headerWidth - 1), "")}…`
					: truncateToWidth(firstLine, headerWidth, "…");
			const gap = suffix ? " ".repeat(Math.max(2, width - 2 - visibleWidth(label) - visibleWidth(suffix))) : "";
			return [truncateToWidth(`${statusIcon(call, theme)} ${label}${gap}${suffix}`, width, "…")];
		},
		invalidate() {
			header.invalidate?.();
		},
	};
}

function callSummary(calls: CodemodeNestedCall[], isPartial: boolean, isError: boolean): string {
	if (calls.length === 0) return isPartial ? "Running script" : isError ? "Script failed" : "Script completed";
	const parts: string[] = [];
	for (const [status, label] of [
		["ok", "completed"],
		["running", "running"],
		["error", "failed"],
		["cancelled", "cancelled"],
	] as const) {
		const count = calls.filter((call) => call.status === status).length;
		if (count > 0) parts.push(`${plural(count, "call")} ${label}`);
	}
	return `${isError ? "Script failed · " : ""}${parts.join(", ")}`;
}

export const codemodeRenderers: Pick<
	ToolDefinition<TSchema, CodemodeToolDetails | undefined>,
	"renderCall" | "renderResult"
> = {
	renderCall(args, theme, context) {
		startToolTimer(context);
		const code = str((args as { code?: unknown } | undefined)?.code);
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		if (code === null) {
			component.addChild(new Text(formatToolCall(theme, "Codemode", theme.fg("error", "[invalid arg]")), 0, 0));
			return component;
		}
		const source = replaceTabs((code ?? "").replace(/\r/g, "").trimEnd());
		if (context.expanded) {
			component.addChild(new Text(formatToolCall(theme, "Codemode"), 0, 0));
			if (source) {
				const state = context.state as CodemodeRenderState;
				state.scriptHighlighter ??= new CodeHighlighter();
				component.addChild(new Text(state.scriptHighlighter.highlight(source, "javascript").join("\n"), 0, 0));
			}
		} else {
			const preview =
				source
					.split("\n")
					.find((line) => line.trim() && !line.startsWith("// @options:"))
					?.trim() || "…";
			component.addChild({
				render(width) {
					const snippet = truncateToWidth(theme.fg("toolOutput", preview), Math.max(0, width - 10), "…");
					return [truncateToWidth(formatToolCall(theme, "Codemode", snippet), width, "…")];
				},
				invalidate() {},
			});
		}
		return component;
	},
	renderResult(result, options, theme, context) {
		const timerText = toolTimerText(context, options.isPartial);
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		const calls = result.details?.calls ?? [];
		component.addChild(
			new Text(
				formatToolSummary(theme, callSummary(calls, options.isPartial, context.isError), !options.expanded),
				0,
				0,
			),
		);
		const shown = options.expanded ? calls : calls.slice(-CALL_PREVIEW_COUNT);
		if (shown.length < calls.length) {
			component.addChild(
				new Text(
					`${theme.fg("muted", `${plural(calls.length - shown.length, "earlier call")},`)} ${keyHint("app.tools.expand", "to expand")}`,
					0,
					0,
				),
			);
		}
		for (const call of shown) {
			component.addChild(nestedCallRow(call, theme, context));
			if (options.expanded && call.args)
				component.addChild(new Text(theme.fg("muted", `  ${replaceTabs(call.args)}`), 0, 0));
			if (call.error) {
				const error = theme.fg("error", replaceTabs(call.error));
				component.addChild(
					options.expanded
						? new Text(error, 2, 0)
						: new VisualLinePreview({
								text: error,
								maxVisualLines: 1,
								keep: "start",
								formatHint: (hidden, compact) => expandHint(theme, hidden, "error lines", compact),
							}),
				);
			}
		}
		const priced = calls.filter((call) => call.cost);
		if (priced.length > 1)
			component.addChild(
				new Text(
					theme.fg("muted", `Model calls: ${formatCost(priced.reduce((sum, call) => sum + (call.cost ?? 0), 0))}`),
					0,
					0,
				),
			);

		const [first, ...rest] = result.content;
		const hasHeader = first?.type === "text" && SCRIPT_HEADER.test(first.text);
		let output = options.isPartial
			? ""
			: getTextOutput({ ...result, content: hasHeader ? rest : result.content }, context.showImages).trim();
		const fullOutputPath = result.details?.fullOutputPath;
		if (fullOutputPath) {
			output = output.replace(OUTPUT_TRUNCATION_HEADER, "");
			const footer = `\n\n[Full output: ${fullOutputPath} (read with offset/limit)]`;
			output = output.replace(footer, "").trimEnd();
		}
		if (output) {
			component.addChild(new Spacer(1));
			const styled = replaceTabs(output)
				.split("\n")
				.map((line) => theme.fg(context.isError ? "error" : "toolOutput", line))
				.join("\n");
			component.addChild(
				options.expanded
					? new Text(styled, 0, 0)
					: new VisualLinePreview({
							text: styled,
							maxVisualLines: OUTPUT_PREVIEW_LINES,
							keep: "start",
							formatHint: (hidden, compact) => expandHint(theme, hidden, "lines", compact),
						}),
			);
		}
		if (fullOutputPath) {
			component.addChild(
				new Text(
					`${theme.fg("warning", "Output truncated")} ${theme.fg("muted", "· Full output: ")}${linkPath(theme.fg("muted", shortenPath(fullOutputPath)), fullOutputPath, context.cwd)}`,
					0,
					0,
				),
			);
		}
		if (timerText) {
			component.addChild(new Spacer(1));
			component.addChild(new Text(theme.fg("muted", timerText), 0, 0));
		}
		return component;
	},
};
