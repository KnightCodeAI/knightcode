// Recipes (spec section 5): the portable bot JSON other bot apps read and write. Import shows a plan the user ticks:
// from the user's own export everything starts ticked; from someone else, memory and routines start unticked and
// nothing is ever offered to shared memory (another person's facts are not the user's). Routines arrive paused and
// carry no triggers; plugins are matched to connectors by id. Export writes the bot's profile, notes, skills and
// routines' prompts; parseRecipe reads it back unchanged.
import { parseRecipe, type Recipe } from "@knightcode/bots-protocol";

export interface PlanItem<T> {
	item: T;
	ticked: boolean;
}

export interface ImportPlan {
	profile: Recipe["profile"];
	memory: PlanItem<Recipe["memory"][number]>[];
	/** Memory items offered to shared memory (all bots). Only from the user's own export, and only profile facts. */
	sharedMemory: PlanItem<Recipe["memory"][number]>[];
	skills: PlanItem<Recipe["skills"][number]>[];
	routines: PlanItem<Recipe["routines"][number]>[];
	plugins: PlanItem<Recipe["plugins"][number]>[];
	/** The setup skill, run only when the user ticks it. */
	gettingStarted?: string;
}

export function importRecipe(recipe: Recipe, origin: "self" | "other"): ImportPlan {
	const own = origin === "self";
	const parsed = parseRecipe(recipe);
	return {
		profile: parsed.profile,
		memory: parsed.memory.map((item) => ({ item, ticked: own })),
		sharedMemory: own ? parsed.memory.filter((item) => item.kind === "profile").map((item) => ({ item, ticked: false })) : [],
		skills: parsed.skills.map((item) => ({ item, ticked: true })),
		routines: parsed.routines.map((item) => ({ item, ticked: own })),
		plugins: parsed.plugins.map((item) => ({ item, ticked: true })),
		...(parsed.gettingStarted ? { gettingStarted: parsed.gettingStarted.skill } : {}),
	};
}

/** What export reads of a bot. */
export interface BotSnapshot {
	name: string;
	instructions: string;
	avatar?: { color?: string; shape?: string };
	notes: { body: string; type: string; updatedAt: number }[];
	skills: { name: string; description: string; content: string }[];
	routines: { name: string; prompt: string }[];
	appIds: string[];
}

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "routine";

export function exportRecipe(bot: BotSnapshot): Recipe {
	return parseRecipe({
		profile: {
			name: bot.name,
			description: bot.instructions,
			...(bot.avatar?.color ? { avatarColor: bot.avatar.color } : {}),
			...(bot.avatar?.shape ? { avatarShape: bot.avatar.shape } : {}),
		},
		memory: bot.notes.map((note) => ({
			kind: note.type === "preference" || note.type === "fact" ? "profile" : "log",
			createdAt: new Date(note.updatedAt).toISOString(),
			content: note.body,
		})),
		skills: bot.skills.map((skill) => ({ name: skill.name, description: skill.description, content: skill.content })),
		routines: bot.routines.map((routine) => ({ name: routine.name, slug: slug(routine.name), description: routine.name, content: routine.prompt })),
		plugins: bot.appIds.map((id) => ({ name: id, pluginId: id })),
	});
}
