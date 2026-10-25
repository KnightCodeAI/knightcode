/**
 * Presentation for the task_stop tool.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `task-stop.ts` spreads these into its
 * definition, so the tool's public shape is unchanged.
 */

import { Text } from "@knightcode/tui";
import type { ToolDefinition } from "../../extensions/types.ts";
import { formatToolCall, getTextOutput, str } from "../render-utils.ts";
import type { TaskStopToolDetails } from "../task-stop.ts";

export const taskStopRenderers: Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> = {
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		const taskId = str((args as { task_id?: unknown } | undefined)?.task_id);
		text.setText(formatToolCall(theme, "Stop", theme.fg("accent", taskId || "...")));
		return text;
	},
	renderResult(result, _options, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		// A failed call carries `{}` as its details.
		const details = result.details as Partial<TaskStopToolDetails> | undefined;
		if (context.isError || typeof details?.command !== "string") {
			text.setText(theme.fg(context.isError ? "error" : "toolOutput", getTextOutput(result, false).trim()));
			return text;
		}
		const line = details.command.replace(/\s+/g, " ").trim();
		const command = line.length > 120 ? `${line.slice(0, 119)}…` : line;
		const status = details.alreadyEnded
			? "Already ended"
			: details.status === "running"
				? "Stopping (process still exiting)"
				: "Stopped";
		text.setText(`${theme.fg("toolOutput", status)} ${theme.fg("muted", `· ${command}`)}`);
		return text;
	},
};
