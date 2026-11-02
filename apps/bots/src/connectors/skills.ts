// Connector skills (spec section 9): connecting an app offers its skills behind one checkbox, ticked by default. Only
// each skill's one-line description sits in the prompt; its body loads when the bot uses it. Skills can be removed
// without disconnecting the app. Usage notes are at most 500 characters and always followed.
import type { CatalogEntry } from "@knightcode/bots-protocol";

export const USAGE_NOTE_MAX = 500;

export interface ConnectorSkill {
	appId: string;
	name: string;
	description: string;
}

/** What the connect screen offers, with its single checkbox ticked. */
export function offeredSkills(entry: CatalogEntry): { skills: ConnectorSkill[]; checked: true } {
	return { skills: entry.skills.map((skill) => ({ appId: entry.id, name: skill.name, description: skill.description })), checked: true };
}

/** A usage note as stored: trimmed and capped. */
export const usageNote = (text: string) => text.trim().slice(0, USAGE_NOTE_MAX);

/** The prompt lines for enabled skills and the usage notes of the apps a bot uses: one line each, never a skill body. */
export function connectorPromptLines(input: {
	skills: ConnectorSkill[];
	notes: { appName: string; note: string }[];
}): string | undefined {
	const lines = [
		...input.skills.map((skill) => `- skill ${skill.name} (${skill.appId}): ${skill.description.replace(/\s+/g, " ").slice(0, 200)}`),
		...input.notes.filter((note) => note.note).map((note) => `- when using ${note.appName}: ${usageNote(note.note)}`),
	];
	return lines.length ? `Connected apps (load a skill with tool_search before using it):\n${lines.join("\n")}` : undefined;
}
