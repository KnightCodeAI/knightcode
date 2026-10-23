import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item } from "@knightcode/app-server-protocol";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test, vi } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";

const SERVER = join(import.meta.dirname, "../../examples/mcp-app/server.mjs");
const dirs: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await cleanupServers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A server whose agent dir configures the example counter app, by default with the default (codemode) exposure. */
async function appServer(exposure?: "direct") {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-mcp-apps-"));
	dirs.push(agentDir);
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: { counter: { command: process.execPath, args: [SERVER], ...(exposure ? { exposure } : {}) } },
		}),
	);
	// The MCP extension reads mcp.json from the agent dir it resolves itself.
	vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", agentDir);
	return startServer({ agentDir });
}

type ToolCall = Extract<Item, { type: "toolCall" }>;

/** The model calls the app tool; Full access, so the model's own call needs no approval. */
async function callApp(mode: "desktop" | "tui", exposure?: "direct") {
	const server = await appServer(exposure);
	const a = await server.connect(mode);
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd, approvalMode: "fullAccess" });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("mcp__counter__show_counter", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("shown")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "show the counter" });
	await a.waitFor("turn/completed", undefined, 30_000);
	const turns = await a.readTurns(thread.id);
	const call = turns.flatMap((t) => t.items).find((i): i is ToolCall => i.type === "toolCall")!;
	return { server, a, thread, call };
}

test("in the desktop an app tool's call carries its app, with the server's whole result", async () => {
	const { call } = await callApp("desktop");
	expect(call).toMatchObject({ tool: "mcp__counter__show_counter", status: "completed" });
	expect(call.mcpApp).toEqual({
		server: "counter",
		resourceUri: "ui://counter/app.html",
		result: { content: [{ type: "text", text: "The counter is at 0." }], structuredContent: { count: 0 } },
	});
}, 60_000);

test("the terminal draws no apps: the same call has only its text", async () => {
	// Declared to the model as the configuration says: in the terminal an app tool is an ordinary tool.
	const { call } = await callApp("tui", "direct");
	expect(call.status).toBe("completed");
	expect(call.mcpApp).toBeUndefined();
	expect(call.output).toEqual([{ type: "text", text: "The counter is at 0." }]);
}, 60_000);

test("an app reads its resource and calls its server's tools, asking first for one that changes things", async () => {
	const { a, thread } = await callApp("desktop");
	const resource = await a.client.request("mcp/app/readResource", {
		threadId: thread.id,
		server: "counter",
		uri: "ui://counter/app.html",
	});
	expect(resource.contents[0]).toMatchObject({ uri: "ui://counter/app.html", mimeType: "text/html;profile=mcp-app" });
	// Read-only: no confirmation.
	expect(
		await a.client.request("mcp/app/callTool", { threadId: thread.id, server: "counter", name: "read_count" }),
	).toMatchObject({ structuredContent: { count: 0 } });
	// Not read-only, in Ask mode: refused until confirmed.
	await a.client.request("thread/settings/update", { threadId: thread.id, approvalMode: "ask" });
	const increment = { threadId: thread.id, server: "counter", name: "increment", arguments: { by: 2 } };
	await expect(a.client.request("mcp/app/callTool", increment)).rejects.toMatchObject({ code: "approvalRequired" });
	expect(await a.client.request("mcp/app/callTool", { ...increment, confirmed: true })).toEqual({
		content: [{ type: "text", text: "The counter is now 2." }],
		structuredContent: { count: 2 },
	});
	// Full access runs it at once.
	await a.client.request("thread/settings/update", { threadId: thread.id, approvalMode: "fullAccess" });
	expect(await a.client.request("mcp/app/callTool", increment)).toMatchObject({ structuredContent: { count: 4 } });
}, 60_000);

test("an app reaches only its own connected server, within the size bounds", async () => {
	const { a, thread } = await callApp("desktop");
	await expect(
		a.client.request("mcp/app/callTool", { threadId: thread.id, server: "elsewhere", name: "read_count" }),
	).rejects.toMatchObject({ code: "mcpUnavailable" });
	await expect(
		a.client.request("mcp/app/callTool", { threadId: thread.id, server: "counter", name: "nope" }),
	).rejects.toMatchObject({ code: "invalidParams" });
	await expect(
		a.client.request("mcp/app/callTool", {
			threadId: thread.id,
			server: "counter",
			name: "read_count",
			arguments: { pad: "x".repeat(1024 * 1024) },
		}),
	).rejects.toMatchObject({ code: "invalidParams", message: expect.stringContaining("arguments too large") });
}, 60_000);

test("a tool only apps may call is not declared to the model", async () => {
	const server = await appServer();
	const a = await server.connect("desktop");
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd, approvalMode: "fullAccess" });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("mcp__counter__increment", { by: 1 })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("tried")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "increment" });
	await a.waitFor("turn/completed", undefined, 30_000);
	const call = (await a.readTurns(thread.id))
		.flatMap((t) => t.items)
		.find((i): i is ToolCall => i.type === "toolCall")!;
	expect(call.status).toBe("failed");
	// The count never moved.
	expect(
		await a.client.request("mcp/app/callTool", { threadId: thread.id, server: "counter", name: "read_count" }),
	).toMatchObject({ structuredContent: { count: 0 } });
}, 60_000);
