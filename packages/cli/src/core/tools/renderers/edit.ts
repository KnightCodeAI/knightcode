/**
 * Presentation for the edit tool.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `edit.ts` spreads these into its
 * definition, so the tool's public shape is unchanged.
 */

import { Box, Container, Text } from "@knightcode/tui";
import { diffView } from "../../../modes/interactive/components/diff.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../../extensions/types.ts";
import type { EditToolDetails } from "../edit.ts";
import { computeEditsDiff, type Edit, type EditDiffError, type EditDiffResult } from "../edit-diff.ts";
import { formatToolCall, renderToolPath, str } from "../render-utils.ts";

type EditPreview = EditDiffResult | EditDiffError;
export type EditRenderState = {
	callComponent?: EditCallRenderComponent;
};
type RenderableEditArgs = {
	path?: string;
	file_path?: string;
	edits?: Edit[];
	oldText?: string;
	newText?: string;
};
type EditToolResultLike = {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: EditToolDetails;
};
type EditCallRenderComponent = Box & {
	preview?: EditPreview;
	previewArgsKey?: string;
	previewPending?: boolean;
	settledError?: boolean;
};
function createEditCallRenderComponent(): EditCallRenderComponent {
	return Object.assign(new Box(0, 0), {
		preview: undefined as EditPreview | undefined,
		previewArgsKey: undefined as string | undefined,
		previewPending: false,
		settledError: false,
	});
}
function getEditCallRenderComponent(state: EditRenderState, lastComponent: unknown): EditCallRenderComponent {
	if (lastComponent instanceof Box) {
		const component = lastComponent as EditCallRenderComponent;
		state.callComponent = component;
		return component;
	}
	if (state.callComponent) {
		return state.callComponent;
	}
	const component = createEditCallRenderComponent();
	state.callComponent = component;
	return component;
}
function getRenderablePreviewInput(args: RenderableEditArgs | undefined): { path: string; edits: Edit[] } | null {
	if (!args) {
		return null;
	}

	const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : null;
	if (!path) {
		return null;
	}

	if (
		Array.isArray(args.edits) &&
		args.edits.length > 0 &&
		args.edits.every((edit) => typeof edit?.oldText === "string" && typeof edit?.newText === "string")
	) {
		return { path, edits: args.edits };
	}

	if (typeof args.oldText === "string" && typeof args.newText === "string") {
		return { path, edits: [{ oldText: args.oldText, newText: args.newText }] };
	}

	return null;
}
function formatEditCall(args: RenderableEditArgs | undefined, theme: Theme, cwd: string): string {
	const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
	return formatToolCall(theme, "Update", pathDisplay);
}

function editPath(args: RenderableEditArgs | undefined): string | undefined {
	return str(args?.file_path ?? args?.path) || undefined;
}

/** Count changed lines in a display diff (`+123 text` / `-123 text` / ` 123 text`). */
function summarizeDiff(diff: string): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+")) additions++;
		else if (line.startsWith("-")) removals++;
	}
	return { additions, removals };
}

/** `Added 3 lines, removed 1 line`, with the counts in bold. */
export function formatDiffSummary(diff: string, theme: Theme): string {
	const { additions, removals } = summarizeDiff(diff);
	const count = (n: number, word: string) => `${word} ${theme.bold(String(n))} ${n === 1 ? "line" : "lines"}`;
	const parts: string[] = [];
	if (additions > 0) parts.push(count(additions, "Added"));
	if (removals > 0) parts.push(count(removals, parts.length > 0 ? "removed" : "Removed"));
	return theme.fg("toolOutput", parts.length > 0 ? parts.join(", ") : "No changes");
}
function formatEditResult(
	preview: EditPreview | undefined,
	result: EditToolResultLike,
	theme: Theme,
	isError: boolean,
): { summary: string; diff?: string } | undefined {
	const previewDiff = preview && !("error" in preview) ? preview.diff : undefined;
	const previewError = preview && "error" in preview ? preview.error : undefined;
	if (isError) {
		const errorText = result.content
			.filter((c) => c.type === "text")
			.map((c) => c.text || "")
			.join("\n");
		if (!errorText || errorText === previewError) {
			return undefined;
		}
		return { summary: theme.fg("error", errorText) };
	}

	const diff = result.details?.diff ?? previewDiff;
	if (!diff) {
		return undefined;
	}
	return { summary: formatDiffSummary(diff, theme), diff };
}
function buildEditCallComponent(
	component: EditCallRenderComponent,
	args: RenderableEditArgs | undefined,
	theme: Theme,
	cwd: string,
	showPreview: boolean,
): EditCallRenderComponent {
	component.clear();
	component.addChild(new Text(formatEditCall(args, theme, cwd), 0, 0));

	if (!showPreview || !component.preview) {
		return component;
	}

	if ("error" in component.preview) {
		component.addChild(new Text(theme.fg("error", component.preview.error), 0, 0));
	} else {
		component.addChild(diffView(component.preview.diff, { filePath: editPath(args) }));
	}
	return component;
}
function setEditPreview(
	component: EditCallRenderComponent,
	preview: EditPreview,
	argsKey: string | undefined,
): boolean {
	const current = component.preview;
	const changed =
		current === undefined ||
		("error" in current && "error" in preview
			? current.error !== preview.error
			: "error" in current !== "error" in preview) ||
		(!("error" in current) &&
			!("error" in preview) &&
			(current.diff !== preview.diff || current.firstChangedLine !== preview.firstChangedLine));
	component.preview = preview;
	component.previewArgsKey = argsKey;
	component.previewPending = false;
	return changed;
}

export const editRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const component = getEditCallRenderComponent(context.state, context.lastComponent);
		const previewInput = getRenderablePreviewInput(args as RenderableEditArgs | undefined);
		const argsKey = previewInput ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits }) : undefined;

		if (component.previewArgsKey !== argsKey) {
			component.preview = undefined;
			component.previewArgsKey = argsKey;
			component.previewPending = false;
			component.settledError = false;
		}

		if (context.argsComplete && previewInput && !component.preview && !component.previewPending) {
			component.previewPending = true;
			const requestKey = argsKey;
			void computeEditsDiff(previewInput.path, previewInput.edits, context.cwd).then((preview) => {
				if (component.previewArgsKey === requestKey) {
					setEditPreview(component, preview, requestKey);
					context.invalidate();
				}
			});
		}

		return buildEditCallComponent(
			component,
			args as RenderableEditArgs | undefined,
			theme,
			context.cwd,
			context.isPartial,
		);
	},
	renderResult(result, _options, theme, context) {
		const callComponent = context.state.callComponent;
		const previewInput = getRenderablePreviewInput(context.args as RenderableEditArgs | undefined);
		const argsKey = previewInput ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits }) : undefined;
		const typedResult = result as EditToolResultLike;
		const resultDiff = !context.isError ? typedResult.details?.diff : undefined;
		let changed = false;
		if (callComponent) {
			if (typeof resultDiff === "string") {
				changed =
					setEditPreview(
						callComponent,
						{ diff: resultDiff, firstChangedLine: typedResult.details?.firstChangedLine },
						argsKey,
					) || changed;
			}
			if (callComponent.settledError !== context.isError) {
				callComponent.settledError = context.isError;
				changed = true;
			}
			if (changed) {
				// Keep the preview visible on failure: formatEditResult() suppresses an error that
				// duplicates the preflight one, so hiding it here would leave only the header.
				buildEditCallComponent(
					callComponent,
					context.args as RenderableEditArgs | undefined,
					theme,
					context.cwd,
					context.isError,
				);
			}
		}

		const output = formatEditResult(callComponent?.preview, typedResult, theme, context.isError);
		const component = (context.lastComponent as Container | undefined) ?? new Container();
		component.clear();
		if (!output) {
			return component;
		}
		component.addChild(new Text(output.summary, 0, 0));
		if (output.diff) {
			component.addChild(diffView(output.diff, { filePath: editPath(context.args as RenderableEditArgs | undefined) }));
		}
		return component;
	},
};
