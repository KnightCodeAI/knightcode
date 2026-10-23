#!/usr/bin/env node
/**
 * A stdio MCP server with one MCP App: a counter. It needs no dependencies (newline-delimited JSON-RPC over stdio).
 *
 * - `show_counter` (model and app): shows the counter; its `_meta.ui.resourceUri` names the app, `ui://counter/app.html`.
 * - `increment` (app only, `_meta.ui.visibility: ["app"]`): changes the count, so outside Full access the desktop
 *   asks the user before it runs.
 * - `read_count` (read-only): what the count is; an app may call it without asking.
 *
 * Add it to `~/.knightcode/agent/mcp.json`:
 *
 *   { "mcpServers": { "counter": { "command": "node", "args": ["/path/to/server.mjs"], "exposure": "direct" } } }
 *
 * In the desktop app, ask KnightCode to show the counter: the tool's row draws the app. In the terminal, which draws
 * no apps, the tool answers with its text.
 */

import { createInterface } from "node:readline";

const APP_URI = "ui://counter/app.html";
const APP_MIME = "text/html;profile=mcp-app";
let count = 0;

const APP_HTML = `<!doctype html>
<meta charset="utf-8">
<style>
	body { margin: 0; padding: 12px 14px; font: 14px var(--font-sans, system-ui); color: var(--color-text-primary, #111);
		background: var(--color-background-primary, transparent); }
	.row { display: flex; align-items: center; gap: 10px; }
	output { font: 600 22px var(--font-mono, monospace); min-width: 3ch; }
	button { font: inherit; padding: 4px 12px; border-radius: var(--border-radius-md, 8px);
		border: 1px solid var(--color-border-primary, #ccc); background: var(--color-background-secondary, #f4f4f4);
		color: inherit; cursor: pointer; }
	#status { margin-top: 8px; color: var(--color-text-secondary, #666); font-size: 12px; }
</style>
<div class="row">
	<span>Count</span><output id="count">…</output>
	<button id="add">Add one</button>
	<button id="tell">Tell KnightCode</button>
</div>
<div id="status"></div>
<script>
	const pending = new Map();
	let next = 0;
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
		});
	const notify = (method, params) => parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
	const show = (n) => (document.getElementById("count").textContent = String(n));
	const status = (text) => (document.getElementById("status").textContent = text);
	const theme = (context) => {
		for (const [name, value] of Object.entries(context?.styles?.variables ?? {}))
			if (value) document.documentElement.style.setProperty(name, value);
	};
	window.addEventListener("message", (event) => {
		const message = event.data;
		if (!message || message.jsonrpc !== "2.0") return;
		if (message.id !== undefined && !message.method) {
			const waiter = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) waiter?.reject(new Error(message.error.message));
			else waiter?.resolve(message.result);
			return;
		}
		if (message.method === "ui/notifications/tool-result") show(message.params?.structuredContent?.count ?? "?");
		else if (message.method === "ui/notifications/tool-cancelled") status("The call was cancelled");
		else if (message.method === "ui/notifications/host-context-changed") theme(message.params);
		else if (message.method === "ui/resource-teardown") parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
		else if (message.method === "ping") parent.postMessage({ jsonrpc: "2.0", id: message.id, result: {} }, "*");
	});
	document.getElementById("add").onclick = async () => {
		try {
			const result = await request("tools/call", { name: "increment", arguments: { by: 1 } });
			show(result.structuredContent.count);
			status("");
		} catch (error) {
			status(error.message);
		}
	};
	document.getElementById("tell").onclick = async () => {
		const now = document.getElementById("count").textContent;
		try {
			await request("ui/message", { role: "user", content: [{ type: "text", text: "The counter app shows " + now + "." }] });
			status("Sent");
		} catch (error) {
			status(error.message);
		}
	};
	(async () => {
		const init = await request("ui/initialize", {
			protocolVersion: "2026-01-26",
			appInfo: { name: "counter", version: "1.0.0" },
			appCapabilities: { availableDisplayModes: ["inline"] },
		});
		theme(init.hostContext);
		notify("ui/notifications/initialized", {});
		notify("ui/notifications/size-changed", { height: document.documentElement.scrollHeight });
	})();
</script>`;

const tools = [
	{
		name: "show_counter",
		description: "Show the counter app with the current count.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true },
		_meta: { ui: { resourceUri: APP_URI } },
	},
	{
		name: "increment",
		description: "Add to the counter.",
		inputSchema: { type: "object", properties: { by: { type: "number" } } },
		_meta: { ui: { visibility: ["app"] } },
	},
	{
		name: "read_count",
		description: "Read the counter.",
		inputSchema: { type: "object", properties: {} },
		annotations: { readOnlyHint: true },
	},
];

const countResult = (text) => ({ content: [{ type: "text", text }], structuredContent: { count } });

function answer(method, params) {
	switch (method) {
		case "initialize":
			return {
				protocolVersion: params?.protocolVersion ?? "2025-11-25",
				capabilities: { tools: {}, resources: {} },
				serverInfo: { name: "counter-app", version: "1.0.0" },
			};
		case "ping":
			return {};
		case "tools/list":
			return { tools };
		case "tools/call":
			if (params?.name === "show_counter") return countResult(`The counter is at ${count}.`);
			if (params?.name === "increment") {
				count += Number(params.arguments?.by ?? 1);
				return countResult(`The counter is now ${count}.`);
			}
			if (params?.name === "read_count") return countResult(String(count));
			throw Object.assign(new Error(`no tool ${params?.name}`), { code: -32602 });
		case "resources/list":
			return { resources: [{ uri: APP_URI, name: "Counter app", mimeType: APP_MIME }] };
		case "resources/read":
			if (params?.uri !== APP_URI) throw Object.assign(new Error(`no resource ${params?.uri}`), { code: -32002 });
			return {
				contents: [
					{ uri: APP_URI, mimeType: APP_MIME, text: APP_HTML, _meta: { ui: { prefersBorder: true, csp: {} } } },
				],
			};
		default:
			throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
	}
}

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	// Notifications (no id) need no answer.
	if (message.id === undefined || message.id === null) return;
	try {
		write({ jsonrpc: "2.0", id: message.id, result: answer(message.method, message.params) });
	} catch (error) {
		write({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32603, message: error.message } });
	}
});
