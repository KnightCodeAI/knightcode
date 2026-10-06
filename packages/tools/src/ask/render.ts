import { Text } from "@knightcode/tui";
import type { Theme, ToolDefinition } from "@knightcodeai/cli";
import { getTextOutput, plural } from "@knightcodeai/cli/core/tools/render-utils";
import type { AskUserDetails, AskUserParams, askUserSchema } from "./tool.ts";

interface RenderableResult {
	content: Array<{ type: string; text?: string }>;
	details?: AskUserDetails;
}

/** What the header knows: nothing yet, the outcome, or that the call failed before asking. */
type Outcome = AskUserDetails | "failed" | undefined;

/**
 * The call row reads "Questions" and the count, like a heading, rather than the tool name: while
 * the picker is open it counts the questions, afterwards how many were answered.
 */
export function askHeaderText(args: Partial<AskUserParams> | undefined, outcome: Outcome, theme: Theme): string {
	const title = theme.bold("Questions");
	if (outcome === "failed") return `${title}${theme.fg("muted", " not asked")}`;
	if (!outcome) {
		const count = Array.isArray(args?.questions) ? args.questions.length : 0;
		return `${title}${theme.fg("muted", ` ${plural(count, "question")} for you`)}`;
	}
	if (outcome.status === "no_user") return `${title}${theme.fg("muted", " not asked: no user")}`;
	const answered = outcome.questions.filter((q) => outcome.answers[q.id]).length;
	const summary = theme.fg("muted", ` ${answered}/${outcome.questions.length} answered`);
	return `${title}${summary}${outcome.status === "interrupted" ? theme.fg("warning", " (interrupted)") : ""}`;
}

/** Each question with its answer, so the transcript shows what was decided. */
export function askResultText(result: RenderableResult, theme: Theme): string {
	const d = result.details;
	if (!d) return theme.fg("toolOutput", getTextOutput(result, false).trim().split("\n")[0] ?? "");
	if (d.status === "no_user") return theme.fg("muted", "The agent takes the recommended options.");
	const lines: string[] = [];
	for (const q of d.questions) {
		const a = d.answers[q.id];
		lines.push(`• ${theme.fg("toolOutput", q.question)}${a ? "" : theme.fg("muted", " (unanswered)")}`);
		const answer = a?.label ?? a?.other;
		if (answer !== undefined) lines.push(`  ${theme.fg("muted", "answer:")} ${theme.fg("accent", answer)}`);
		if (a?.note) lines.push(`  ${theme.fg("muted", "note:")} ${theme.fg("accent", a.note)}`);
	}
	return lines.join("\n");
}

function textComponent(context: { lastComponent?: unknown }): Text {
	return (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
}

interface RowState {
	header?: Text;
	outcome?: Outcome;
}

export const askRenderers: Pick<
	ToolDefinition<typeof askUserSchema, AskUserDetails, RowState>,
	"renderCall" | "renderResult"
> = {
	renderCall(args, theme, context) {
		const text = textComponent(context);
		// renderResult runs after this on every update and rewrites the header once there is an outcome.
		context.state.header = text;
		text.setText(askHeaderText(args, context.state.outcome, theme));
		return text;
	},
	renderResult(result, _options, theme, context) {
		context.state.outcome = result.details ?? "failed";
		context.state.header?.setText(askHeaderText(context.args, context.state.outcome, theme));
		const text = textComponent(context);
		text.setText(askResultText(result, theme));
		return text;
	},
};
