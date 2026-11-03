// apps/bots/test/skills.test.ts
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { InputRecorder } from "../src/computer/screens.ts";
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
	await runInDurableObject(env.BOT.get(env.BOT.idFromName("teach-raw")), async (_instance, state) => {
		const teaching = new Teaching(state.storage.sql);
		const { sessionId } = await teaching.startTeaching("sign in");
		await teaching.recordStep(sessionId, { kind: "protected-input", target: "Password", value: "hunter2" } as never);
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

it("reads clicks, typed text and named keys from a control screen's RFB stream", () => {
	const recorder = new InputRecorder();
	// Handshake: version, the security type, ClientInit; then encodings and a pixel request, which are not steps.
	expect(recorder.feed(new Uint8Array([...new TextEncoder().encode("RFB 003.008\n"), 1, 1]))).toEqual([]);
	expect(recorder.feed(new Uint8Array([2, 0, 0, 1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 5, 0, 3, 32]))).toEqual([]);
	const pointer = (buttons: number, x: number, y: number) => [5, buttons, x >> 8, x & 255, y >> 8, y & 255];
	const key = (keysym: number) => [4, 1, 0, 0, (keysym >>> 24) & 255, (keysym >>> 16) & 255, (keysym >>> 8) & 255, keysym & 255, 4, 0, 0, 0, (keysym >>> 24) & 255, (keysym >>> 16) & 255, (keysym >>> 8) & 255, keysym & 255];
	const typed = [..."Q3x"].flatMap((char) => key(char.charCodeAt(0)));
	// A press and its release are one click; a backspace removes the typo; Enter ends the text. Split mid-message.
	const stream = new Uint8Array([...pointer(1, 300, 40), ...pointer(0, 300, 40), ...typed, ...key(0xff08), ...key(0xff0d)]);
	const events = [...recorder.feed(stream.subarray(0, 9)), ...recorder.feed(stream.subarray(9))];
	expect(events).toEqual([{ kind: "click", x: 300, y: 40 }, { kind: "type", text: "Q3" }, { kind: "key", keys: ["Enter"] }]);
	recorder.feed(new Uint8Array(key("r".charCodeAt(0))));
	expect(recorder.flush()).toEqual([{ kind: "type", text: "r" }]);
});

it("records the owner's demonstration on the bot's control screen into the teaching session", async () => {
	const seen: string[] = [];
	const models = fakeModels([{ text: "" }]);
	setModelsFactory(() => ({
		...models,
		getModel: models.getModel.bind(models),
		completeSimple: async (_model: unknown, context: { messages: { content: string }[] }) => {
			seen.push(context.messages[0]!.content);
			return { role: "assistant", stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ name: "Open the report", description: "weekly", content: "1. Click Reports" }) }] };
		},
	}) as never);
	const owner: Principal = { accountId: "acct-teach-screen", workspaceId: "acct-teach-screen", client: "web" };
	await env.USER.get(env.USER.idFromName(owner.accountId)).grantCredits(1_000, "teach-grant");
	const bot = env.BOT.get(env.BOT.idFromName("teach-screen-bot"));
	await bot.claim(owner, { provider: "fake", modelId: "fake-model" });
	const computer = env.COMPUTER.get(env.COMPUTER.idFromName(owner.accountId));
	const { url } = await computer.screenUrl(owner, "teach-screen-bot", "control");
	const response = await SELF.fetch(url, { headers: { upgrade: "websocket" } });
	const socket = response.webSocket!;
	socket.accept();
	const { sessionId } = await bot.startTeaching(owner, "open this week's report");
	// As noVNC sends them: ArrayBuffers.
	const send = (bytes: number[]) => socket.send(new Uint8Array(bytes).buffer);
	send([...new TextEncoder().encode("RFB 003.008\n")]);
	send([1]);
	send([1]);
	send([5, 1, 0, 20, 0, 30, 5, 0, 0, 20, 0, 30]);
	for (const char of "Q3") send([4, 1, 0, 0, 0, 0, 0, char.charCodeAt(0)]);
	await new Promise((resolve) => setTimeout(resolve, 200));
	const draft = await bot.stopTeaching(owner, sessionId);
	socket.close();
	expect(draft.name).toBe("Open the report");
	// The steps the model drafted from: the click, then the typed text (flushed when recording stopped).
	expect(seen.at(-1)).toContain("click at 20,30");
	expect(seen.at(-1)).toContain('type "Q3"');
});

it("a bot reads its saved skills with read_skill; the owner's skills too, other bots' not", async () => {
	setModelsFactory(() => fakeModels([{ text: "ok" }]));
	const bot = env.BOT.get(env.BOT.idFromName("skill-reader"));
	await bot.claim(principal, { provider: "fake", modelId: "fake-model" });
	await user().skillAdd({ name: "Open the report", description: "weekly report", content: "1. Click Reports", scope: "bot", botId: "skill-reader" });
	await user().skillAdd({ name: "Someone else's", description: "x", content: "secret steps", scope: "bot", botId: "another-bot" });
	const read = (name: string) =>
		runInDurableObject(bot, async (instance) => {
			const tool = (instance as unknown as BotObject).tools().find((candidate) => candidate.name === "read_skill")!;
			return (await tool.execute({ name } as never, undefined as never, undefined as never)) as { output: { text: string }[]; isError?: boolean };
		});
	expect((await read("Open the report")).output[0]!.text).toBe("1. Click Reports");
	expect(await read("Someone else's")).toMatchObject({ isError: true });
});
