import type { Recipe } from "@knightcode/bots-protocol";
import { describe, expect, it } from "vitest";
import { extractJson } from "../src/bot/ImportAgent.tsx";
import { noteAge } from "../src/bot/MemoryViewer.tsx";
import { cleanRecipe, defaultSelection, memoryBlocked, redactCredentials } from "../src/bot/RecipePreview.tsx";
import { TEMPLATE_AREAS, TEMPLATES } from "../src/bot/templates-data.ts";

const recipe: Recipe = {
	profile: { name: "Old", description: "Use key sk-abcdefghijklmnopqrstuv to call the API" },
	memory: [{ content: "likes tea" }, { content: "my password: hunter22" }],
	skills: [{ name: "setup", description: "d", content: "token=ghp_abcdefghijklmnopqrstuvwxyz0123" }],
	routines: [{ name: "daily", slug: "daily", description: "d", content: "p" }],
	plugins: [{ name: "Gmail", pluginId: "gmail" }],
	gettingStarted: { skill: "setup" },
};

describe("importing a recipe", () => {
	it("never brings in credential-like text", () => {
		expect(redactCredentials("plain words").removed).toBe(0);
		const cleaned = cleanRecipe(recipe, defaultSelection(recipe));
		expect(cleaned.profile.description).toBe("Use key [removed] to call the API");
		expect(cleaned.skills[0]!.content).not.toContain("ghp_");
		expect(memoryBlocked("my password: hunter22")).toBe(true);
		expect(memoryBlocked("likes tea")).toBe(false);
		expect(redactCredentials("AKIAABCDEFGHIJKLMNOP and xoxb-1234567890-abc").removed).toBe(2);
	});

	it("starts with instructions and skills ticked, and nothing that acts on its own", () => {
		expect(defaultSelection(recipe)).toEqual({
			instructions: true,
			memory: [],
			sharedMemory: [],
			skills: [0],
			routines: [],
			plugins: [],
			runSetup: false,
		});
		expect(cleanRecipe(recipe, { ...defaultSelection(recipe), instructions: false }).profile.description).toBe("");
	});

	it("reads the JSON out of a fenced answer", () => {
		expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nThanks')).toBe('{"a":1}');
		expect(extractJson(' {"a":1} ')).toBe('{"a":1}');
	});
});

describe("templates", () => {
	it("cover the spec's 44 roles in its areas, with unique ids", () => {
		expect(TEMPLATES).toHaveLength(44);
		expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(44);
		for (const t of TEMPLATES) expect(TEMPLATE_AREAS).toContain(t.area);
	});
});

describe("noteAge", () => {
	it("shows an age only after a day", () => {
		const now = Date.UTC(2026, 10, 1);
		expect(noteAge(now - 3_600_000, now)).toBeUndefined();
		expect(noteAge(now - 86_400_000, now)).toBe("1 day ago");
		expect(noteAge(now - 47 * 86_400_000, now)).toBe("47 days ago");
	});
});
