import { describe, expect, it } from "vitest";
import {
	ApiError,
	createApiClient,
	createFakeBackend,
	decodeFrame,
	defaultSeed,
	seedFrom,
	encodeFrame,
	type ServerFrame,
} from "../src/index.ts";

const client = (fake = createFakeBackend()) => ({ fake, api: createApiClient(fake.fetch, "https://bots.test") });

describe("models are always the user's choice", () => {
	it("gives a new bot the account's chosen default model", async () => {
		const { fake, api } = client();
		const created = await api.createBot({ name: "Helper" });
		expect(created.model).toEqual(fake.state.account.defaultModel);
	});

	it("refuses to create a bot when the user has chosen no model", async () => {
		const seed = defaultSeed();
		seed.account.defaultModel = undefined;
		const { api } = client(createFakeBackend(seed));
		await expect(api.createBot({ name: "Helper" })).rejects.toMatchObject({ status: 400, code: "model_required" });
	});
});

describe("webhooks", () => {
	it("shows the secret URL once and stores only the hook id", async () => {
		const { api } = client();
		const minted = await api.mintWebhook({ id: "rt-incident" });
		expect(minted.url).toMatch(/^https:\/\/bots\.knightcode\.dev\/hooks\//);
		const stored = await api.getRoutine({ id: "rt-incident" });
		expect(JSON.stringify(stored)).not.toContain(minted.url);
	});
});

describe("provider enrollment", () => {
	it("accepts an enrollment token once", async () => {
		const { api } = client();
		const { token } = await api.beginEnrollment({ provider: "fake-oauth" });
		expect(
			(await api.completeEnrollment({ provider: "fake-oauth", token, credential: { kind: "oauth" } })).status,
		).toBe("connected");
		await expect(api.completeEnrollment({ provider: "fake-oauth", token, credential: {} })).rejects.toBeInstanceOf(
			ApiError,
		);
	});
});

describe("pages", () => {
	it("restores an earlier version as a new one", async () => {
		const { api } = client();
		const page = await api.getPage({ id: "roadmap" });
		await api.updatePage({ id: "roadmap", baseVersion: page.version, title: "Renamed" });
		const restored = await api.restorePageVersion({ id: "roadmap", version: String(page.version) });
		expect(restored.title).toBe("Roadmap");
		expect(restored.version).toBe(page.version + 2);
	});
});

describe("threads", () => {
	it("resumes a subscription from a version with only the ops it missed", async () => {
		const fake = createFakeBackend();
		const frames: ServerFrame[] = [];
		const socket = fake.connect();
		socket.addEventListener("message", (e) => frames.push(decodeFrame(String(e.data)) as ServerFrame));
		socket.send(encodeFrame({ type: "auth", ticket: "t" }));
		socket.send(encodeFrame({ type: "subscribe", botId: "inbox" }));
		await fake.clock.runAll();
		const view = frames.find((f) => f.type === "view")!;
		const since = view.type === "view" ? view.version : -1;
		socket.send(encodeFrame({ type: "unsubscribe", botId: "inbox" }));
		await createApiClient(fake.fetch, "https://bots.test").answerApproval({ id: "appr-dana", decision: "deny" });
		frames.length = 0;
		socket.send(encodeFrame({ type: "subscribe", botId: "inbox", since }));
		await fake.clock.runAll();
		expect(frames.filter((f) => f.type !== "event").map((f) => f.type)).toEqual(["ops"]);
	});

	it("passes some turns when everyone in a group is asked", async () => {
		const fake = createFakeBackend();
		const socket = fake.connect();
		socket.send(encodeFrame({ type: "auth", ticket: "t" }));
		socket.send(encodeFrame({ type: "submit", groupId: "launch", text: "@everyone status?", requestId: "r1" }));
		await fake.clock.runAll();
		const { entries } = await createApiClient(fake.fetch, "https://bots.test").getGroupHistory({ groupId: "launch" });
		expect(entries.slice(-3).map((e) => e.kind)).toContain("turn");
	});
});

describe("review fixes", () => {
	it("expires an approval through the op log, settling its inbox item", async () => {
		const fake = createFakeBackend();
		const frames: ServerFrame[] = [];
		const socket = fake.connect();
		socket.addEventListener("message", (e) => frames.push(decodeFrame(String(e.data)) as ServerFrame));
		socket.send(encodeFrame({ type: "auth", ticket: "t" }));
		socket.send(encodeFrame({ type: "subscribe", botId: "inbox" }));
		await fake.clock.runAll();
		await fake.clock.advance(25 * 3_600_000);
		frames.length = 0;
		const api = createApiClient(fake.fetch, "https://bots.test");
		expect((await api.answerApproval({ id: "appr-dana", decision: "allow" })).result).toBe("expired");
		await fake.clock.runAll();
		expect(JSON.stringify(frames.filter((f) => f.type === "ops"))).toContain("expired");
		expect((await api.listInbox({})).items.find((i) => i.id === "in-approval")?.done).toBe(true);
		expect(fake.executed("appr-dana")).toBe(0);
	});

	it("gives a new bot an address only when it is free and valid", async () => {
		const { api } = client();
		expect((await api.createBot({ name: "Reviewer" })).email).toBeUndefined();
		const helper = await api.createBot({ name: "Helper" });
		expect(helper.email).toBe("helper.raghav@bots.knightcode.dev");
		expect((await api.getChannels({})).addresses).toContainEqual({ botId: helper.id, address: helper.email });
	});

	it("ends a streamed reply with the full text and the run stopped", async () => {
		const fake = createFakeBackend();
		const socket = fake.connect();
		socket.send(encodeFrame({ type: "auth", ticket: "t" }));
		socket.send(encodeFrame({ type: "submit", botId: "inbox", text: "hello", requestId: "r1" }));
		await fake.clock.runAll();
		const view = await createApiClient(fake.fetch, "https://bots.test").getHistory({ botId: "inbox" });
		const last = view.entries.at(-1);
		expect(view.running).toBe(false);
		expect(last).toMatchObject({ kind: "message", role: "assistant", text: fake.state.replies.inbox });
		expect(last && "streaming" in last).toBe(false);
	});

	it("says ready with the seed's own account id", async () => {
		const fake = createFakeBackend();
		const frames: ServerFrame[] = [];
		const socket = fake.connect();
		socket.addEventListener("message", (e) => frames.push(decodeFrame(String(e.data)) as ServerFrame));
		socket.send(encodeFrame({ type: "auth", ticket: "t" }));
		await fake.clock.runAll();
		expect(frames[0]).toEqual({ type: "ready", accountId: fake.state.account.id });
	});
});

describe("seeds", () => {
	it("fills fields a partial seed leaves out from the default seed", () => {
		const seed = seedFrom({ bots: [] });
		expect(seed.bots).toEqual([]);
		expect(seed.catalog.length).toBeGreaterThan(0);
	});
});

describe("importing a recipe with a setup skill", () => {
	const recipe = {
		profile: { name: "Imported", description: "Help with the inbox" },
		memory: [],
		skills: [{ name: "setup", description: "Set up", content: "Ask three questions" }],
		routines: [],
		plugins: [],
		gettingStarted: { skill: "setup" },
	};
	const selection = { memory: [], sharedMemory: [], skills: [0], routines: [], plugins: [] };

	it("always adds a Run setup button and never runs setup unless asked", async () => {
		const { fake, api } = client();
		const { bot } = await api.importRecipe({ recipe, origin: "other", ...selection, runSetup: false });
		const view = await api.getHistory({ botId: bot.id });
		expect(view.entries.some((e) => e.kind === "card" && e.card.type === "run-setup" && e.card.skill === "setup")).toBe(
			true,
		);
		expect(fake.state.runs.some((run) => run.botId === bot.id)).toBe(false);
	});

	it("starts the setup run when the user ticked it", async () => {
		const { fake, api } = client();
		const { bot } = await api.importRecipe({ recipe, origin: "other", ...selection, runSetup: true });
		expect(fake.state.runs.find((run) => run.botId === bot.id)?.title).toBe("Setup: setup");
	});
});

describe("creating a bot from a template", () => {
	it("applies the template and adds its routines paused", async () => {
		const seed = defaultSeed();
		seed.templates = [
			{
				id: "daily",
				name: "Daily Briefing",
				area: "Productivity",
				description: "A morning summary",
				instructions: "Write the brief",
				avatar: { shape: "egg", color: "yellow" },
				connectors: ["gmail"],
				routines: [{ name: "Daily briefing", prompt: "Write this morning's briefing." }],
			},
		];
		const { fake, api } = client(createFakeBackend(seed));
		const bot = await api.createBot({ name: "Brief", templateId: "daily" });
		expect(bot.instructions).toBe("Write the brief");
		const routines = fake.state.routines.filter((r) => r.botId === bot.id);
		expect(routines.map((r) => [r.name, r.active])).toEqual([["Daily briefing", false]]);
	});
});
