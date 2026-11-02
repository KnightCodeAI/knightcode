// "Save that as a skill" (spec section 18): after a multi-step task the bot writes a skill from what it just did, shown
// as a draft card the user edits and saves. The draft comes from the bot's own model, given the run's messages.
import type { SkillDraft } from "@knightcode/bots-protocol";
import type { Helper } from "../memory/recall.ts";

const DRAFT_FORMAT =
	'Reply with JSON only: {"name": "short name", "description": "when to use it, one line", "content": "the steps, ' +
	'numbered, then what to check and when to ask the owner first"}.';

/** The draft in a model's JSON reply, or a plain draft of the whole reply when it is not JSON. */
export function parseDraft(reply: string, fallbackName: string): SkillDraft {
	const start = reply.indexOf("{");
	const end = reply.lastIndexOf("}");
	try {
		const value = JSON.parse(reply.slice(start, end + 1)) as Partial<SkillDraft>;
		if (typeof value.content === "string" && value.content.trim())
			return {
				name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 80) : fallbackName,
				description: typeof value.description === "string" ? value.description.replace(/\s+/g, " ").slice(0, 300) : "",
				content: value.content.trim(),
			};
	} catch {
		// Not JSON: keep the text as the steps.
	}
	return { name: fallbackName, description: "", content: reply.trim() };
}

/** A skill draft from a run, given its messages as plain text ("user: …", "assistant: …", tool calls). */
export async function draftFromRun(run: { transcript: string; helper: Helper }): Promise<SkillDraft> {
	const reply = await run.helper(
		`Write a reusable skill from the task the assistant just completed: the general steps (not this run's specifics), ` +
			`what to check, and when to ask the owner before acting. ${DRAFT_FORMAT}`,
		run.transcript.slice(-60_000),
	);
	return parseDraft(reply, "New skill");
}

export { DRAFT_FORMAT };
