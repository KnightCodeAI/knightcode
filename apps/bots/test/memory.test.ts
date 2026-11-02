// apps/bots/test/memory.test.ts
import { beforeEach, expect, it } from "vitest";
import { countRun, dream } from "../src/memory/dream.ts";
import { extractAfterRun } from "../src/memory/extract.ts";
import { memoryText } from "../src/memory/index-file.ts";
import { setEmbedderFactory } from "../src/memory/memory.ts";
import type { NoteInput } from "../src/memory/notes.ts";
import { renderRecalled } from "../src/memory/recall.ts";
import { shareNotes } from "../src/memory/shared.ts";
import { callTool, claim, context, fakeEmbedder, seedMessages, withMemory } from "./memory-helpers.ts";

const DAY = 86_400_000;

beforeEach(async () => {
	await claim("b1");
	await claim("b2");
});

it("makes a note eligible again after compaction drops it", async () => {
	await writeNote("b1", { name: "tea", description: "likes tea", body: "Prefers green tea" });
	expect(await recallFor("b1", "what tea?")).toContain("tea");
	// Still in the prompt: not recalled twice.
	expect(await recallFor("b1", "more tea?")).not.toContain("tea");
	await compactAway("b1", "tea");
	expect(await recallFor("b1", "what tea again?")).toContain("tea");
});
it("recalls a corrected note again while the old version is still in the prompt", async () => {
	await writeNote("b1", { name: "tea", description: "likes tea", body: "Prefers green tea" });
	await recallFor("b1", "what tea?");
	await writeNote("b1", { name: "tea", description: "likes tea", body: "Prefers black tea now" });
	expect(await recallFor("b1", "which tea?")).toContain("tea");
});
it("finds a reworded fact with no shared keyword when embeddings exist", async () => {
	await withEmbeddings(async () => {
		await writeNote("b1", { name: "drink", description: "beverage preference", body: "Prefers green tea" });
		expect(await recallFor("b1", "what should I brew for them?")).toContain("drink");
	});
	// Without embeddings it is keyword search only.
	expect(await recallFor("b1", "what should I brew for them?")).toEqual([]);
});
it("labels ages older than a day", async () => {
	expect(await renderAged("b1", { ageDays: 47 })).toContain("47 days ago");
	expect(await renderAged("b1", { ageDays: 0 })).not.toContain("ago");
});
it("search_history refuses a message id from another bot", async () => {
	await seedMessages("b1", [{ role: "user", text: "the launch is on Friday", at: Date.now() }]);
	await seedMessages("b2", [{ role: "user", text: "a secret plan for b2", at: Date.now() }]);
	const own = (await callTool("b1", "search_history", { query: "launch" })) as { hits: { ref: string }[] };
	expect(own.hits).toHaveLength(1);
	const other = (await callTool("b2", "search_history", { query: "secret" })) as { hits: { ref: string }[] };
	await expect(callTool("b1", "read_history", { ref: other.hits[0]!.ref })).rejects.toThrow(/not found/);
	// Another bot's id on a message number this bot does have: still refused.
	await expect(callTool("b1", "read_history", { ref: own.hits[0]!.ref.replace(/^b1:/, "b2:") })).rejects.toThrow(/not found/);
	// A made-up ref with this bot's id but no such message is refused the same way.
	await expect(callTool("b1", "read_history", { ref: "b1:999999" })).rejects.toThrow(/not found/);
	const read = (await callTool("b1", "read_history", { ref: own.hits[0]!.ref })) as { messages: { text: string }[] };
	expect(read.messages.map((message) => message.text)).toContain("the launch is on Friday");
});
it("shows the index and open work, never note content", async () => {
	await writeNote("b1", { name: "tea", description: "likes tea", body: "Prefers green tea" });
	const text = await withMemory("b1", (memory) => {
		memory.openWork.add("Finish the quarterly report");
		return memoryText(memory.notes, memory.openWork);
	});
	expect(text).toContain("- tea: likes tea");
	expect(text).toContain("Finish the quarterly report");
	expect(text).not.toContain("green");
});
it("extracts notes after a run unless the run wrote its own", async () => {
	const helper = async () => '[{"name": "editor", "description": "preferred editor", "body": "Uses Zed", "type": "preference"}]';
	const saved = await withMemory("b1", (memory) =>
		extractAfterRun({ notes: memory.notes, helper, transcript: "user: I use Zed", wroteNotes: false, outside: false }),
	);
	expect(saved).toEqual(["editor"]);
	const skipped = await withMemory("b1", (memory) =>
		extractAfterRun({ notes: memory.notes, helper, transcript: "user: I use Zed", wroteNotes: true, outside: false }),
	);
	expect(skipped).toEqual([]);
});
it("consolidates once enough has changed: dates, duplicates, contradictions", async () => {
	// Noon, so the copy written a second earlier means the same "tomorrow".
	const now = Date.UTC(2026, 10, 2, 12);
	const helper = async () => '{"delete": ["db-old"], "merge": []}';
	// A bot of its own: other tests' notes would count here.
	await claim("dreamer");
	const result = await withMemory("dreamer", async (memory, sql) => {
		memory.notes.write({ name: "trip", description: "trip date", body: "Flying out tomorrow" }, now - 10 * DAY);
		memory.notes.write({ name: "trip-copy", description: "trip date", body: "Flying out tomorrow" }, now - 10 * DAY - 1_000);
		memory.notes.write({ name: "db-old", description: "database", body: "Uses Postgres" }, now - 5 * DAY);
		memory.notes.write({ name: "db", description: "database", body: "Switched to SQLite" }, now - DAY);
		const early = await dream({ sql, notes: memory.notes, helper }, { minHours: 24, minRuns: 5, now });
		for (let run = 0; run < 5; run++) countRun(sql);
		const ran = await dream({ sql, notes: memory.notes, helper }, { minHours: 24, minRuns: 5, now });
		return { early, ran, names: memory.notes.list().map((note) => note.name), trip: memory.notes.get("trip")?.body };
	});
	expect(result.early.ran).toBe(false);
	expect(result.ran.ran).toBe(true);
	expect(result.names.sort()).toEqual(["db", "trip"]);
	expect(result.trip).toBe(`Flying out on ${new Date(now - 9 * DAY).toISOString().slice(0, 10)}`);
});
it("shares only notes that do not look private, and asks before sharing outside-written ones", async () => {
	const put: string[] = [];
	const result = await withMemory("b1", (memory) => {
		memory.notes.write({ name: "company", description: "where they work", body: "Works at Acme" });
		memory.notes.write({ name: "email", description: "contact", body: "Personal mail is jo@example.com" });
		memory.notes.write({ name: "from-mail", description: "vendor", body: "Vendor is Globex", outside: true });
		return shareNotes({
			notes: memory.notes,
			names: ["company", "email", "from-mail"],
			shared: { put: async (note) => void put.push(note.name) },
		});
	});
	expect(result).toEqual({ shared: ["company"], keptBack: 1, needsApproval: ["from-mail"] });
	expect(put).toEqual(["company"]);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const writeNote = (botId: string, note: NoteInput, at?: number) => withMemory(botId, (memory) => memory.notes.write(note, at));

const recallFor = (botId: string, message: string) => withMemory(botId, (memory) => memory.recall(message));

/** Drops everything before now from the model's context, as compaction does with old turns. */
const compactAway = (botId: string, _name: string) =>
	withMemory(botId, async (memory) => (await memory.conversation()).reset(undefined, context));

async function withEmbeddings(fn: () => Promise<void>): Promise<void> {
	setEmbedderFactory(() => fakeEmbedder);
	try {
		await fn();
	} finally {
		setEmbedderFactory(undefined);
	}
}

const renderAged = (botId: string, options: { ageDays: number }) =>
	withMemory(botId, (memory) => {
		const note = memory.notes.write(
			{ name: `aged-${options.ageDays}`, description: "an old fact", body: "Lives in Lisbon" },
			Date.now() - options.ageDays * DAY,
		);
		return renderRecalled([note]);
	});
