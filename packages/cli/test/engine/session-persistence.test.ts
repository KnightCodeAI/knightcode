import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@knightcode/ai";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext } from "../../src/engine/context.ts";
import type { EngineEvent } from "../../src/engine/events.ts";
import { createSessionRegistry, type SessionRegistry } from "../../src/engine/sessions.ts";

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** The user and assistant text a session holds, one line per message. */
function transcript(messages: readonly unknown[]): string[] {
	return messages.flatMap((message) => {
		const { role, content } = message as { role: string; content: unknown };
		if (role !== "user" && role !== "assistant") return [];
		const text =
			typeof content === "string"
				? content
				: (content as { type: string; text?: string }[])
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("");
		return [`${role}: ${text}`];
	});
}

describe("saved sessions", () => {
	let counter = 0;
	const dirs: string[] = [];
	let registry: SessionRegistry | undefined;

	afterEach(async () => {
		await registry?.closeAll();
		registry = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(options: { prompts?: Record<string, string> } = {}) {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-saved-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-saved-agent-"));
		dirs.push(cwd, agentDir);
		for (const [name, body] of Object.entries(options.prompts ?? {})) {
			mkdirSync(join(agentDir, "prompts"), { recursive: true });
			writeFileSync(join(agentDir, "prompts", `${name}.md`), body);
		}
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-saved-${counter++}` });
		ctx.models.registerNativeProvider(faux.provider);
		const ends: EngineEvent[] = [];
		const started: string[] = [];
		ctx.events.subscribe((event) => {
			if (event.type === "session.turn_end") ends.push(event);
			if (event.type === "session.created") started.push(event.sessionId);
		});
		// Transcripts go to the default layout under the temporary agent directory.
		const created = createSessionRegistry(ctx, { agentDir, defaultModel: faux.getModel() });
		registry = created;
		const turn = async (id: string, text: string, reply: string): Promise<void> => {
			const before = ends.length;
			faux.setResponses([fauxAssistantMessage([fauxText(reply)])]);
			await created.prompt(id, { text });
			await until(() => ends.length > before);
		};
		return { cwd, agentDir, registry: created, turn, started };
	}

	test("a closed session reopens from its transcript and carries on", async () => {
		const { cwd, registry, turn } = await start();
		const { id } = await registry.create({ cwd });
		await turn(id, "remember the word apple", "Noted.");
		await registry.close(id);
		expect(registry.summary(id)).toBeUndefined();

		const reopened = await registry.open({ id, cwd });
		expect(reopened.id).toBe(id);
		expect(transcript(registry.messages(id))).toEqual(["user: remember the word apple", "assistant: Noted."]);

		await turn(id, "what was the word?", "apple");
		expect(transcript(registry.messages(id))).toEqual([
			"user: remember the word apple",
			"assistant: Noted.",
			"user: what was the word?",
			"assistant: apple",
		]);
	});

	test("opening a session that is live, or opening one twice at once, starts one session", async () => {
		const { cwd, registry, turn, started } = await start();
		const { id } = await registry.create({ cwd });
		await turn(id, "hi", "hello");

		const live = await Promise.all([registry.open({ id, cwd }), registry.open({ id, cwd })]);
		expect(live.map((summary) => summary.id)).toEqual([id, id]);
		expect(started).toEqual([id]);

		await registry.close(id);
		const reopened = await Promise.all([registry.open({ id, cwd }), registry.open({ id, cwd })]);
		expect(reopened.map((summary) => summary.id)).toEqual([id, id]);
		// Two sessions started on one transcript would be two writers; exactly one more started.
		expect(started).toEqual([id, id]);
		expect(registry.size()).toBe(1);
	});

	test("a session opens only for its own project, even once a listing across projects has seen it", async () => {
		const { cwd, registry, turn } = await start();
		const other = mkdtempSync(join(tmpdir(), "knightcode-test-saved-other-"));
		dirs.push(other);
		const { id } = await registry.create({ cwd });
		await turn(id, "hi", "hello");
		await registry.close(id);

		expect((await registry.list({})).sessions.map((listing) => listing.id)).toContain(id);
		await expect(registry.open({ id, cwd: other })).rejects.toMatchObject({ code: "not_found" });
		expect(registry.size()).toBe(0);
	});

	test("a delete while the session is being opened waits for the open, then removes both", async () => {
		const { cwd, registry, turn } = await start();
		const { id } = await registry.create({ cwd });
		await turn(id, "hi", "hello");
		await registry.close(id);

		const opening = registry.open({ id, cwd });
		const deleted = await registry.delete(id);
		await opening.catch(() => undefined);
		expect(deleted).toBe(true);
		expect(registry.summary(id)).toBeUndefined();
		expect((await registry.list({ cwd })).sessions).toEqual([]);
	});

	test("a listing across projects includes a project whose session directory is a link", async () => {
		const { cwd, agentDir, registry, turn } = await start();
		const { id } = await registry.create({ cwd });
		await turn(id, "hi", "hello");
		await registry.close(id);

		// Move the project's session directory elsewhere and link it back in.
		const sessionsRoot = join(agentDir, "sessions");
		const [project] = readdirSync(sessionsRoot);
		const elsewhere = mkdtempSync(join(tmpdir(), "knightcode-test-saved-linked-"));
		dirs.push(elsewhere);
		renameSync(join(sessionsRoot, project), join(elsewhere, project));
		symlinkSync(join(elsewhere, project), join(sessionsRoot, project), "junction");

		expect((await registry.list({})).sessions.map((listing) => listing.id)).toEqual([id]);
	});

	test("an id with no transcript is not found", async () => {
		const { cwd, registry } = await start();
		await expect(registry.open({ id: "no-such-session", cwd })).rejects.toMatchObject({ code: "not_found" });
	});

	test("lists sessions that have messages, newest first, and deletes one live or not", async () => {
		const { cwd, registry, turn } = await start();
		const first = await registry.create({ cwd });
		await turn(first.id, "first session\nwith a second line", "one");
		const second = await registry.create({ cwd });
		await turn(second.id, "second session", "two");
		// Never prompted: nothing to reopen, so not listed.
		await registry.create({ cwd });

		const page = await registry.list({ cwd });
		expect(page.sessions.map((listing) => [listing.id, listing.title])).toEqual([
			[second.id, "second session"],
			[first.id, "first session"],
		]);
		expect(Number.isNaN(Date.parse(page.sessions[0].updatedAt))).toBe(false);
		expect(page.nextCursor).toBeUndefined();
		expect((await registry.list({})).sessions.map((listing) => listing.id)).toEqual([second.id, first.id]);
		await expect(registry.list({ cursor: "nonsense" })).rejects.toMatchObject({ code: "bad_request" });

		await registry.close(first.id);
		expect(await registry.delete(first.id)).toBe(true);
		expect(await registry.delete(first.id)).toBe(false);
		await expect(registry.open({ id: first.id, cwd })).rejects.toMatchObject({ code: "not_found" });

		// Deleting a live session closes it first.
		expect(await registry.delete(second.id)).toBe(true);
		expect(registry.summary(second.id)).toBeUndefined();
		expect((await registry.list({ cwd })).sessions).toEqual([]);
	});

	test("a session offers its prompt templates as commands", async () => {
		const { cwd, registry } = await start({
			prompts: { review: "---\ndescription: Review the change\n---\nReview $@\n" },
		});
		const summary = await registry.create({ cwd });
		expect(summary.commands).toContainEqual(expect.objectContaining({ name: "review" }));
		expect(existsSync(cwd)).toBe(true);
	});
});
