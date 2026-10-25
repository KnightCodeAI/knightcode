import type { Tool } from "@knightcode/mcp";
import { expect, test } from "vitest";
import {
	convertMcpResult,
	createMcpToolDefinition,
	MCP_APP_INLINE_RESULT_MAX_BYTES,
	mcpAppOf,
	visibilityOf,
} from "../src/extensions/mcp/tools.ts";

const tool = (meta?: Record<string, unknown>): Tool => ({
	name: "show",
	inputSchema: { type: "object" },
	...(meta ? { _meta: meta } : {}),
});

test("a tool names its app with a ui:// resource, in _meta.ui or the deprecated key", () => {
	expect(mcpAppOf(tool({ ui: { resourceUri: "ui://app/x.html" } }))).toEqual({
		resourceUri: "ui://app/x.html",
		visibility: ["model", "app"],
	});
	expect(mcpAppOf(tool({ "ui/resourceUri": "ui://app/x.html" }))?.resourceUri).toBe("ui://app/x.html");
	expect(mcpAppOf(tool({ ui: { resourceUri: "https://app/x.html" } }))).toBeUndefined();
	expect(mcpAppOf(tool())).toBeUndefined();
	expect(visibilityOf(tool({ ui: { visibility: ["app", "elsewhere"] } }))).toEqual(["app"]);
	expect(visibilityOf(tool())).toEqual(["model", "app"]);
});

function exposureOf(meta: Record<string, unknown>, configured: "codemode" | "direct" | "hidden", drawsApps = true) {
	const definition = createMcpToolDefinition({
		server: "s",
		tool: tool(meta),
		name: "mcp__s__show",
		exposure: configured,
		namespace: { name: "mcp__s" },
		timeoutMs: 1000,
		getClient: async () => ({ callTool: async () => ({ content: [] }) }),
		...(drawsApps ? { app: mcpAppOf(tool(meta)), visibility: visibilityOf(tool(meta)) } : {}),
	});
	return definition.exposure;
}

test("an app tool is declared to the model only, a model-less one not at all, a hidden one stays hidden", () => {
	const app = { ui: { resourceUri: "ui://s/app.html" } };
	expect(exposureOf(app, "codemode")).toBe("model-only");
	expect(exposureOf(app, "direct")).toBe("model-only");
	expect(exposureOf(app, "hidden")).toBe("hidden");
	expect(exposureOf({ ui: { ...app.ui, visibility: ["app"] } }, "direct")).toBe("hidden");
	// An app's helper: app-only without an app of its own.
	expect(exposureOf({ ui: { visibility: ["app"] } }, "direct")).toBe("hidden");
	// Outside the desktop, and for tools without an app the model may call, the configuration decides.
	expect(exposureOf(app, "codemode", false)).toBe("deferred");
	expect(exposureOf({ ui: { visibility: ["app"] } }, "direct", false)).toBe("direct");
	expect(exposureOf({}, "direct")).toBe("direct");
});

test("the result's details carry the app with the server's whole result, or say it was left out", async () => {
	const app = { resourceUri: "ui://s/app.html", visibility: ["model", "app"] as ("model" | "app")[] };
	const small = { content: [{ type: "text" as const, text: "ok" }], structuredContent: { n: 1 }, _meta: { k: "v" } };
	expect((await convertMcpResult("s", "show", small, { app })).details?.mcpApp).toEqual({
		server: "s",
		resourceUri: "ui://s/app.html",
		result: small,
	});
	const big = { content: [{ type: "text" as const, text: "x".repeat(MCP_APP_INLINE_RESULT_MAX_BYTES) }] };
	expect((await convertMcpResult("s", "show", big, { app, saveOutput: async () => "/tmp/x" })).details?.mcpApp).toEqual(
		{
			server: "s",
			resourceUri: "ui://s/app.html",
			resultOmitted: true,
		},
	);
	expect((await convertMcpResult("s", "show", small)).details?.mcpApp).toBeUndefined();
});
