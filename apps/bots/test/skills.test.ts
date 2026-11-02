// apps/bots/test/skills.test.ts
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { importFromGitHub, NoSkills, parseSkillFile } from "../src/skills/github-import.ts";
import { draftFromRun } from "../src/skills/save-as-skill.ts";
import { Teaching } from "../src/skills/teach.ts";
import { fakeModels } from "./fake-model.ts";

const principal: Principal = { accountId: "acct-skills", workspaceId: "acct-skills", client: "web" };
const user = () => env.USER.get(env.USER.idFromName(principal.accountId));
afterEach(() => setModelsFactory(undefined));

it("keeps a bot-saved skill with that bot until it is shared", async () => {
	const saved = await user().skillAdd({ name: "Weekly CRM export", description: "export the list", content: "1. Open the CRM", scope: "bot", botId: "b1" });
	await user().skillAdd({ name: "House style", description: "how to write", content: "Short sentences.", scope: "user" });
	const names = async (botId: string) => (await user().skillList({ botId })).map((skill) => skill.name).sort();
	expect(await names("b1")).toEqual(["House style", "Weekly CRM export"]);
	expect(await names("b2")).toEqual(["House style"]);
	await user().skillShare(saved.id);
	expect(await names("b2")).toEqual(["House style", "Weekly CRM export"]);
});

it("drafts from a demonstration with the steps and no protected input, and deletes the recording on save", async () => {
	// The bot's model drafts; here it writes the steps it was shown back as the skill.
	const seen: string[] = [];
	const models = fakeModels([{ text: "" }]);
	setModelsFactory(() => ({
		...models,
		getModel: models.getModel.bind(models),
		completeSimple: async (_model: unknown, context: { messages: { content: string }[] }) => {
			const prompt = context.messages[0]!.content;
			seen.push(prompt);
			const steps = prompt.split("Steps:\n")[1] ?? "";
			return {
				role: "assistant",
				stopReason: "stop",
				content: [{ type: "text", text: JSON.stringify({ name: "Export the CRM list", description: "weekly export", content: steps }) }],
			};
		},
	}) as never);
	const bot = env.BOT.get(env.BOT.idFromName("teach-bot"));
	await bot.claim(principal, { provider: "fake", modelId: "fake-model" });
	const { sessionId } = await bot.startTeaching(principal, "export this week's list from the CRM to the shared folder");
	await bot.recordTeachStep(principal, sessionId, { kind: "navigate", url: "https://crm.example/contacts" }, "iVBORw0KGgo=", "[1] link \"Export\"");
	await bot.recordTeachStep(principal, sessionId, { kind: "type", text: "jo@example.com", target: "Email" });
	// The password goes through Protected input: the event is dropped, the value never reaches the bot.
	expect(await bot.recordTeachStep(principal, sessionId, { kind: "protected-input", target: "Password" })).toBe(false);
	await bot.recordTeachStep(principal, sessionId, { kind: "click", x: 10, y: 20, target: "Export" });

	const draft = await bot.stopTeaching(principal, sessionId);
	expect(draft.name).toBe("Export the CRM list");
	expect(draft.content).toContain("open https://crm.example/contacts");
	expect(draft.content).toContain('click "Export"');
	expect(draft.content).not.toMatch(/password|protected/i);
	expect(seen.join("\n")).not.toMatch(/protected input/i);

	const skill = await bot.saveTeachingDraft(principal, sessionId, draft);
	expect(skill).toMatchObject({ scope: "bot", botId: "teach-bot" });
	const leftover = await runInDurableObject(bot, (_instance, state) => ({
		steps: state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM teach_steps").one().n,
		sessions: state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM teach_sessions").one().n,
	}));
	expect(leftover).toEqual({ steps: 0, sessions: 0 });
});

it("never stores protected input, even if the client sends its value", async () => {
	await runInDurableObject(env.BOT.get(env.BOT.idFromName("teach-raw")), (_instance, state) => {
		const teaching = new Teaching(state.storage.sql);
		const { sessionId } = teaching.startTeaching("sign in");
		teaching.recordStep(sessionId, { kind: "protected-input", target: "Password", value: "hunter2" } as never);
		const stored = state.storage.sql.exec<{ event: string }>("SELECT event FROM teach_steps WHERE session_id = ?", sessionId).toArray();
		expect(stored).toEqual([]);
	});
});

it("previews a repository's skills before adding and refuses one with none", async () => {
	const repo: Record<string, unknown> = {
		"https://api.github.com/repos/acme/skills": { default_branch: "main" },
		"https://api.github.com/repos/acme/skills/git/trees/main?recursive=1": {
			tree: [
				{ path: "README.md", type: "blob", size: 10 },
				{ path: "skills/triage/SKILL.md", type: "blob", size: 80 },
				{ path: "skills/release/SKILL.md", type: "blob", size: 80 },
			],
		},
		"https://raw.githubusercontent.com/acme/skills/main/skills/triage/SKILL.md":
			"---\nname: Triage issues\ndescription: Label and route new issues\n---\n1. Read the issue.",
		"https://raw.githubusercontent.com/acme/skills/main/skills/release/SKILL.md": "1. Tag the release.",
		"https://api.github.com/repos/acme/empty": { default_branch: "main" },
		"https://api.github.com/repos/acme/empty/git/trees/main?recursive=1": { tree: [{ path: "README.md", type: "blob", size: 5 }] },
	};
	const fetcher = async (url: string) =>
		url in repo
			? typeof repo[url] === "string"
				? new Response(repo[url] as string)
				: Response.json(repo[url])
			: new Response("not found", { status: 404 });
	const preview = await importFromGitHub("https://github.com/acme/skills", fetcher);
	expect(preview).toEqual([
		{ name: "Triage issues", description: "Label and route new issues", content: "1. Read the issue." },
		{ name: "release", description: "", content: "1. Tag the release." },
	]);
	// Previewing adds nothing; the user picks what to add.
	expect((await user().skillList({ q: "Triage" })).length).toBe(0);
	await expect(importFromGitHub("https://github.com/acme/empty", fetcher)).rejects.toThrow(NoSkills);
	await expect(importFromGitHub("https://gitlab.com/acme/skills", fetcher)).rejects.toThrow(/github\.com/);
	expect(parseSkillFile("no frontmatter", "folder")).toEqual({ name: "folder", description: "", content: "no frontmatter" });
});

it("drafts a skill from a finished run", async () => {
	const draft = await draftFromRun({
		transcript: "user: export the list\nassistant: opened the CRM, exported, saved to shared/",
		helper: async () => '```json\n{"name": "CRM export", "description": "weekly", "content": "1. Open the CRM\\n2. Export"}\n```',
	});
	expect(draft).toEqual({ name: "CRM export", description: "weekly", content: "1. Open the CRM\n2. Export" });
});
