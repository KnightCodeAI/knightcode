// apps/bots/test/tools.test.ts
import type { Models } from "@knightcode/ai";
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { TOOL_BUDGET_BYTES, visibleToolBytes as bytesOf } from "../src/tools/catalog.ts";
import { HELP_DOCS } from "../src/tools/help-docs.ts";
import { fakeModels } from "./fake-model.ts";

const principal: Principal = { accountId: "acct-a", workspaceId: "acct-a", client: "web" };

beforeEach(() => {
	const models = fakeModels([{ text: "ok" }]);
	setModelsFactory(() => models);
});
afterEach(() => setModelsFactory(undefined));

it("keeps the visible tool list under budget", async () => {
	await claim("b1");
	expect(await visibleToolBytes("b1")).toBeLessThan(6 * 1024);
	expect(TOOL_BUDGET_BYTES).toBe(6 * 1024);
});
it("refuses to widen powers from chat", async () => {
	await claim("b1");
	await expect(callTool("b1", "update_bot", { computerAccess: true })).rejects.toThrow(/settings/);
	await expect(callTool("b1", "update_bot", { approvals: "never" })).rejects.toThrow(/settings/);
	expect(await callTool("b1", "update_bot", { name: "Rex" })).toMatchObject({ name: "Rex" });
	// Reading without fields returns the settings; narrowing to Ask is allowed.
	expect(await callTool("b1", "update_bot", {})).toMatchObject({ name: "Rex", computerAccess: false });
	expect(await callTool("b1", "update_bot", { approvals: "ask" })).toMatchObject({ approvals: "ask" });
});
it("hides image generation without an image model", async () => {
	await claim("b1-no-image-provider");
	expect(await toolNames("b1-no-image-provider")).not.toContain("generate_image");
});
it("offers image generation, deferred, when a provider has an image model", async () => {
	const models = fakeModels([{ text: "ok" }]);
	const image = { id: "fake-image", provider: "fake", api: "fake-images", type: "image", name: "Fake image" };
	setModelsFactory(() => new Proxy(models, { get: (target, key) => (key === "getAvailableOfType" ? async () => [image] : Reflect.get(target, key)) }) as Models);
	await claim("b1-with-image");
	expect(await toolNames("b1-with-image")).toContain("generate_image");
	// Deferred: behind tool_search, so it costs nothing until loaded.
	expect(await toolNames("b1-with-image", { visibleOnly: true })).not.toContain("generate_image");
});
it("offers computer tools only once the owner grants computer access, within budget", async () => {
	await claim("b1-computer");
	expect(await toolNames("b1-computer")).not.toContain("bash");
	await botStub("b1-computer").updateSettings(principal, { computerAccess: true });
	const names = await toolNames("b1-computer");
	expect(names).toEqual(expect.arrayContaining(["bash", "read", "write", "edit", "browser_snapshot", "browser_act", "computer_observe"]));
	expect(await visibleToolBytes("b1-computer")).toBeLessThan(6 * 1024);
	// Chat can turn it back off, never on.
	await callTool("b1-computer", "update_bot", { computerAccess: false });
	expect(await toolNames("b1-computer")).not.toContain("bash");
	await expect(callTool("b1-computer", "update_bot", { computerAccess: true })).rejects.toThrow(/settings/);
});
it("answers product questions from the bundled help documents", async () => {
	await claim("b1");
	expect(Object.keys(HELP_DOCS)).toContain("approvals");
	const answer = await runInDurableObject(botStub("b1"), async (instance) => {
		const tool = (instance as unknown as BotObject).tools().find((candidate) => candidate.name === "help")!;
		const result = (await tool.execute({ topic: "approvals" } as never, undefined as never, undefined as never)) as {
			output: { text: string }[];
		};
		return result.output[0]!.text;
	});
	expect(answer).toContain("# Approvals");
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const botStub = (botId: string) => env.BOT.get(env.BOT.idFromName(botId));

const claim = (botId: string) => botStub(botId).claim(principal, { provider: "fake", modelId: "fake-model" });

const tools = (botId: string) => runInDurableObject(botStub(botId), (instance) => (instance as unknown as BotObject).tools());

const visibleToolBytes = async (botId: string) => bytesOf(await tools(botId));

async function toolNames(botId: string, options: { visibleOnly?: boolean } = {}): Promise<string[]> {
	return (await tools(botId)).filter((tool) => !options.visibleOnly || !tool.deferred).map((tool) => tool.name);
}

/** Calls a tool as the model would; an error result rejects with its text, a success returns its JSON. */
async function callTool(botId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
	const text = await runInDurableObject(botStub(botId), async (instance) => {
		const tool = (instance as unknown as BotObject).tools().find((candidate) => candidate.name === name)!;
		const result = (await tool.execute(args as never, undefined as never, undefined as never)) as {
			output: { text: string }[];
			isError?: boolean;
		};
		const output = result.output.map((block) => block.text).join("");
		return result.isError ? { error: output } : { ok: output };
	});
	if ("error" in text) throw new Error(text.error);
	return JSON.parse(text.ok) as unknown;
}
