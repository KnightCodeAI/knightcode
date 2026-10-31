import { describe, expect, it } from "vitest";
import {
	ApiError,
	createApiClient,
	createFakeBackend,
	decodeFrame,
	defaultSeed,
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
