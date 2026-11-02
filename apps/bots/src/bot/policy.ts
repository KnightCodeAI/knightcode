// Whether an action runs, asks or is refused (spec section 13). Block refuses in every mode. A run outside text started
// or entered acts only within its routine's grant and asks otherwise, in every mode. Allow runs. Then the mode: Never
// ask runs; Ask asks before any change; Auto asks the user's reviewer model, and asks the user when it errors or is unsure.
import type { Models } from "@knightcode/ai";
import type { ApprovalMode, Grant, ModelRef, Rule } from "@knightcode/bots-protocol";
import type { ActionIntent } from "./actions.ts";
import { withinGrant } from "./grants.ts";

/** A reviewer's verdict on one action: "pass" runs it; anything else, or a throw, asks the user. */
export type Reviewer = (action: ActionIntent) => Promise<"pass" | "ask">;

const host = (target: string) => {
	try {
		return new URL(target).hostname;
	} catch {
		return target;
	}
};

/** A tool rule names the tool exactly; a site rule names the target's host. */
export const ruleMatches = (rule: Rule, action: ActionIntent) =>
	rule.kind === "tool" ? rule.value === action.tool : action.target !== undefined && host(action.target) === rule.value;

export async function decide(input: {
	action: ActionIntent;
	mode: ApprovalMode;
	allow: Rule[];
	block: Rule[];
	outside: boolean;
	grant?: Grant;
	used?: { day: number; run: number };
	reviewer?: Reviewer;
}): Promise<"run" | "ask" | "refuse"> {
	const { action } = input;
	if (input.block.some((rule) => ruleMatches(rule, action))) return "refuse";
	if (input.outside) return input.grant && withinGrant(input.grant, action, input.used) ? "run" : "ask";
	if (input.allow.some((rule) => ruleMatches(rule, action))) return "run";
	if (input.mode === "never") return "run";
	if (input.mode === "ask" || !input.reviewer) return "ask";
	try {
		return (await input.reviewer(action)) === "pass" ? "run" : "ask";
	} catch {
		return "ask";
	}
}

/** The Auto mode reviewer on the user's chosen model: passes actions that fit `task`, asks on anything else. */
export function modelReviewer(models: Models, ref: ModelRef, task: string): Reviewer {
	return async (action) => {
		const model = models.getModel(ref.provider, ref.modelId);
		if (!model) throw new Error("reviewer model unavailable");
		const reply = await models.completeSimple(model, {
			systemPrompt:
				"You review one action a bot is about to take for its owner. Answer PASS only if it plainly fits what the owner " +
				"asked for and can be undone. Answer ASK if it is off-task, irreversible, spends money, or you are unsure. " +
				"Answer with one word.",
			messages: [
				{
					role: "user",
					content: `Owner's request:\n${task}\n\nAction:\n${JSON.stringify(action)}`,
					timestamp: Date.now(),
				},
			],
		});
		if (reply.stopReason === "error") throw new Error(reply.errorMessage ?? "reviewer failed");
		const text = reply.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("")
			.trim()
			.toUpperCase();
		return text === "PASS" ? "pass" : "ask";
	};
}
