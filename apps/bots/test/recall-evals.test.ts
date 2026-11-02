// apps/bots/test/recall-evals.test.ts
// Recall across long chats (spec section 6): facts, reworded facts, dates, decisions changed later, and open work, in
// chats of 100, 1,000 and 10,000 messages. The facts sit early in the chat, far outside any prompt window.
import { describe, expect, it } from "vitest";
import { memoryText } from "../src/memory/index-file.ts";
import { setEmbedderFactory } from "../src/memory/memory.ts";
import { callTool, claim, fakeEmbedder, seedMessages, withMemory } from "./memory-helpers.ts";

type Hit = { ref: string; excerpt: string };

/** A chat of `size` messages with the facts at fixed fractions of the way through. */
function chat(size: number) {
	const start = Date.UTC(2026, 0, 1);
	const facts = new Map<number, string>([
		[Math.floor(size * 0.05), "My dentist appointment is on 2026-03-14 at 9am."],
		[Math.floor(size * 0.1), "We decided to use Postgres for the app database."],
		[Math.floor(size * 0.9), "Change of plan: we will use SQLite for the app database instead of Postgres."],
	]);
	return Array.from({ length: size }, (_, index) => ({
		role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
		text: facts.get(index) ?? `Message ${index}: an ordinary exchange about the weekly schedule and errands.`,
		at: start + index * 60_000,
	}));
}

describe.each([100, 1_000, 10_000])("a chat of %i messages", (size) => {
	const bot = `eval-${size}`;
	it(
		"recalls facts, reworded facts, dates, changed decisions and open work",
		async () => {
			await claim(bot);
			await seedMessages(bot, chat(size));
			await withMemory(bot, async (memory) => {
				await memory.notes.write({ name: "dog-name", description: "the owner's dog", body: "The dog is called Biscuit", type: "fact" });
				await memory.notes.write({ name: "drink", description: "beverage preference", body: "Prefers green tea", type: "preference" });
				await memory.openWork.add("Finish the quarterly report");
			});

			// A fact, by keyword.
			expect(await withMemory(bot, (memory) => memory.recall("what is my dog called?"))).toContain("dog-name");
			// A reworded fact, by meaning.
			setEmbedderFactory(() => fakeEmbedder);
			try {
				expect(await withMemory(bot, (memory) => memory.recall("what should I brew for them?"))).toContain("drink");
			} finally {
				setEmbedderFactory(undefined);
			}
			// A date from early in the chat.
			const dentist = (await callTool(bot, "search_history", { query: "dentist appointment" })) as { hits: Hit[] };
			expect(dentist.hits[0]?.excerpt).toContain("2026-03-14");
			// A decision changed later: the newest comes first, and the old one is still reachable.
			const database = (await callTool(bot, "search_history", { query: "database" })) as { hits: Hit[] };
			expect(database.hits[0]?.excerpt).toContain("SQLite");
			expect(database.hits.some((hit) => hit.excerpt.startsWith("We decided to use Postgres"))).toBe(true);
			// Open work is always shown.
			expect(await withMemory(bot, (memory) => memoryText(memory.notes, memory.openWork))).toContain(
				"Finish the quarterly report",
			);
		},
		120_000,
	);
});
