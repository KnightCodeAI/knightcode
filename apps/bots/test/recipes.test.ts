// apps/bots/test/recipes.test.ts
import { parseRecipe, type Recipe } from "@knightcode/bots-protocol";
import { TEMPLATES } from "@knightcode/bots-ui/templates";
import { expect, it } from "vitest";
import { exportRecipe, importRecipe } from "../src/recipes/recipes.ts";
import { listTemplates, templateById } from "../src/templates/gallery.ts";

const recipe: Recipe = {
	profile: { name: "Researcher", description: "Find and summarize sources." },
	memory: [
		{ kind: "profile", content: "The owner is a nurse in Leeds." },
		{ kind: "log", content: "Searched for flu guidance on 2026-10-01." },
	],
	skills: [{ name: "Cite sources", description: "Always cite", content: "1. Link every claim." }],
	routines: [{ name: "Weekly digest", slug: "weekly-digest", description: "digest", content: "Summarize the week." }],
	plugins: [{ name: "Notion", pluginId: "notion" }],
	gettingStarted: { skill: "Cite sources" },
};

it("leaves memory and routines unticked from someone else, and never offers their memory to shared memory", () => {
	const plan = importRecipe(recipe, "other");
	expect(plan.memory.every((item) => !item.ticked)).toBe(true);
	expect(plan.routines.every((item) => !item.ticked)).toBe(true);
	expect(plan.sharedMemory).toEqual([]);
	expect(plan.skills.every((item) => item.ticked)).toBe(true);
	expect(plan.gettingStarted).toBe("Cite sources");
	// The user's own export comes back ticked; only its profile facts may go to shared memory, unticked.
	const own = importRecipe(recipe, "self");
	expect(own.memory.every((item) => item.ticked)).toBe(true);
	expect(own.routines.every((item) => item.ticked)).toBe(true);
	expect(own.sharedMemory.map((item) => [item.item.content, item.ticked])).toEqual([["The owner is a nurse in Leeds.", false]]);
});

it("round-trips exportRecipe through parseRecipe", () => {
	const exported = exportRecipe({
		name: "Researcher",
		instructions: "Find and summarize sources.",
		avatar: { color: "teal", shape: "cloud" },
		notes: [{ body: "The owner is a nurse in Leeds.", type: "fact", updatedAt: Date.UTC(2026, 9, 1) }],
		skills: [{ name: "Cite sources", description: "Always cite", content: "1. Link every claim." }],
		routines: [{ name: "Weekly digest", prompt: "Summarize the week." }],
		appIds: ["notion"],
	});
	expect(parseRecipe(JSON.stringify(exported))).toEqual(exported);
	expect(exported.routines[0]).toMatchObject({ slug: "weekly-digest", content: "Summarize the week." });
	expect(exported.memory[0]).toMatchObject({ kind: "profile", content: "The owner is a nurse in Leeds." });
	expect(JSON.stringify(exported)).not.toMatch(/trigger|cron|token|secret/i);
});

it("serves the interface's own template gallery", () => {
	expect(listTemplates()).toBe(TEMPLATES);
	expect(listTemplates().length).toBeGreaterThanOrEqual(42);
	expect(templateById("pr-reviewer")?.name).toBe("PR Reviewer");
	// Templates carry no files, credentials or memory.
	expect(JSON.stringify(listTemplates())).not.toMatch(/"memory"|"credentials"|"files"/);
});
