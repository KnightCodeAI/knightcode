import type { ExtensionUIContext, ToolDefinition } from "@knightcodeai/cli";
import { type Static, Type } from "typebox";
import { AskPicker, OTHER_LABEL } from "./picker.ts";
import { askRenderers } from "./render.ts";

export const ASK_USER = "ask_user";

export const NO_USER_TEXT =
	"No user is available. Take the recommended option for each question and list it as an assumption.";
export const INTERRUPTED_TEXT = "The user interrupted the questions.";

export const askUserSchema = Type.Object({
	questions: Type.Array(
		Type.Object({
			id: Type.String({ description: "snake_case key for the answer" }),
			question: Type.String({ description: "One sentence" }),
			options: Type.Array(
				Type.Object({
					label: Type.String({ description: "1-5 words" }),
					description: Type.String({ description: "One sentence: the impact of choosing it" }),
				}),
				{ minItems: 2, maxItems: 4 },
			),
		}),
		{ minItems: 1, maxItems: 3 },
	),
});

export type AskUserParams = Static<typeof askUserSchema>;
export type AskQuestion = AskUserParams["questions"][number];

/** One answer: a chosen option with an optional note, or the user's own text. */
export interface AskAnswer {
	label?: string;
	note?: string;
	other?: string;
}

export type AskAnswers = Record<string, AskAnswer>;

export interface AskUserDetails {
	questions: AskQuestion[];
	answers: AskAnswers;
	status: "answered" | "interrupted" | "no_user";
}

/** What the schema cannot express; returned to the model before any UI opens. */
export function validateQuestions(questions: AskQuestion[]): string | undefined {
	const ids = new Set<string>();
	for (const q of questions) {
		if (!q.id.trim()) return "Every question needs an id.";
		if (ids.has(q.id)) return `Question ids must be unique; "${q.id}" repeats.`;
		ids.add(q.id);
		if (!q.question.trim()) return `Question "${q.id}" has no text.`;
		if (q.options.some((o) => !o.label.trim())) return `Question "${q.id}" has an option with no label.`;
	}
	return undefined;
}

/** One line per question, in question order. */
export function formatAnswers(questions: AskQuestion[], answers: AskAnswers): string {
	return questions
		.map((q) => {
			const a = answers[q.id];
			if (a?.label !== undefined) return `${q.id}: ${a.label}${a.note ? `; note: ${a.note}` : ""}`;
			if (a?.other !== undefined) return `${q.id}: Other: ${a.other}`;
			return `${q.id}: unanswered`;
		})
		.join("\n");
}

/**
 * The select and input dialogs, one question at a time, for UIs without custom components (RPC).
 * Returns undefined when the user cancels any dialog.
 */
export async function askWithDialogs(
	questions: AskQuestion[],
	ui: Pick<ExtensionUIContext, "select" | "input">,
	signal: AbortSignal | undefined,
): Promise<AskAnswers | undefined> {
	const answers: AskAnswers = {};
	for (const [index, q] of questions.entries()) {
		// Dialog options are plain strings, so the description rides on the label and the pick maps back by index.
		const rows = [...q.options.map((o) => `${o.label} — ${o.description}`), OTHER_LABEL];
		const title = questions.length > 1 ? `Question ${index + 1}/${questions.length}: ${q.question}` : q.question;
		const picked = await ui.select(title, rows, { signal });
		if (picked === undefined) return undefined;
		const option = q.options[rows.indexOf(picked)];
		if (option) {
			answers[q.id] = { label: option.label };
			continue;
		}
		const text = await ui.input(q.question, "Your answer", { signal });
		if (text === undefined) return undefined;
		if (text.trim()) answers[q.id] = { other: text.trim() };
	}
	return answers;
}

function result(questions: AskQuestion[], answers: AskAnswers, status: AskUserDetails["status"]) {
	const text =
		status === "no_user"
			? NO_USER_TEXT
			: status === "interrupted"
				? INTERRUPTED_TEXT
				: formatAnswers(questions, answers);
	const details: AskUserDetails = { questions, answers, status };
	return { content: [{ type: "text" as const, text }], details };
}

export const askUserTool: ToolDefinition<typeof askUserSchema, AskUserDetails> = {
	name: ASK_USER,
	label: "Ask User",
	description:
		'Ask the user 1-3 multiple-choice questions and wait for the answers. Use it only for intent or trade-offs you cannot settle by reading the code. Put the recommended option first and end its label with "(Recommended)". Do not add an "Other" option; the user can always type their own answer.',
	parameters: askUserSchema,
	// Interactive: codemode scripts must not open dialogs, and two pickers cannot share the editor slot.
	exposure: "model-only",
	executionMode: "sequential",
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const { questions } = params;
		const invalid = validateQuestions(questions);
		if (invalid) throw new Error(invalid);
		if (!ctx.hasUI) return result(questions, {}, "no_user");

		const answers = signal?.aborted
			? undefined
			: ctx.mode === "tui"
				? await ctx.ui.custom<AskAnswers | undefined>(
						(tui, theme, keybindings, done) => new AskPicker(questions, tui, theme, keybindings, done, signal),
					)
				: await askWithDialogs(questions, ctx.ui, signal);
		if (!answers) {
			// Same as pressing Esc at the prompt: the run stops, and this result records why. terminate
			// also skips the aborted model call that would otherwise follow a batch with only this tool.
			ctx.abort();
			return { ...result(questions, {}, "interrupted"), terminate: true };
		}
		return result(questions, answers, "answered");
	},
	...askRenderers,
};
