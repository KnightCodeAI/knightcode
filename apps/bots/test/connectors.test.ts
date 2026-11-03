// apps/bots/test/connectors.test.ts
import type { CatalogEntry } from "@knightcode/bots-protocol";
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import { type CatalogSource, curatedEntries, mergeCatalog } from "../src/connectors/catalog.ts";
import { COMPOSIO_NOTICE, ComposioClient } from "../src/connectors/composio.ts";
import { guardedFetch } from "../src/connectors/guarded-fetch.ts";
import { callMcpTool, listMcpTools } from "../src/connectors/mcp.ts";
import { panelPolicy } from "../src/connectors/mcp-apps.ts";
import { connectorGate, DEFAULT_PERMISSIONS, permissionFor } from "../src/connectors/permissions.ts";
import { indexMarketplace, safePath } from "../src/connectors/plugin-indexer.ts";
import type { UserObject } from "../src/user/user-object.ts";
import { MCP_TEST_TOKEN } from "./emulators/mcp-server.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

it("blocks a redirect from OAuth discovery to a private address", async () => {
	const { url, policy, fetched } = emulatorRedirectTo("http://169.254.169.254/");
	await expect(guardedFetch(url, {}, policy)).rejects.toThrow(/private/);
	expect(fetched).toEqual(["https://auth.example/.well-known/oauth-authorization-server"]);
	// A name that resolves to a private address is refused before any request.
	await expect(guardedFetch("https://internal.example/", {}, { allowPrivate: [], resolve: async () => ["10.0.0.5"] })).rejects.toThrow(
		/private/,
	);
});

it("does not forward a token to another origin on redirect", async () => {
	const seen = await fetchThroughRedirectWithBearer("https://b.example/next");
	expect(seen.firstHop.authorization).toBe("Bearer secret-token");
	expect(seen.secondHop.authorization).toBeUndefined();
	// A redirect within the issuing origin keeps it.
	const same = await fetchThroughRedirectWithBearer("https://a.example/next");
	expect(same.secondHop.authorization).toBe("Bearer secret-token");
});

it("merges sources into one entry per app with no source label", () => {
	const entries = mergeCatalog([curated(["gmail"]), plugins(["gmail", "linear"]), composio(["gmail", "workday"])]);
	expect(entries.map((e) => e.id).sort()).toEqual(["gmail", "linear", "workday"]);
	expect(JSON.stringify(entries)).not.toMatch(/"source"/);
	// The curated copy wins.
	expect(entries.find((e) => e.id === "gmail")?.description).toBe("from curated");
	// The shipped curated list is valid catalog data.
	expect(curatedEntries().length).toBeGreaterThan(3);
	expect(curatedEntries().every((e) => e.id && e.name && e.category)).toBe(true);
});

it("connects a remote MCP server through the emulator and calls a tool", async () => {
	const url = env.EMULATE_MCP_URL!;
	// The emulator is on this machine, so the test allows its private address the way a user allows a home service.
	const policy = { allowPrivate: [new URL(url).host] };
	const tools = await listMcpTools({ url, token: MCP_TEST_TOKEN }, policy);
	expect(tools.map((tool) => tool.name)).toEqual(["list_issues", "create_issue"]);
	const result = await callMcpTool({ url, token: MCP_TEST_TOKEN }, policy, "list_issues", { repo: "owner/repo" });
	expect(JSON.stringify(result.content)).toContain("First issue in owner/repo");
	// Without the allowance the same private address is refused.
	await expect(listMcpTools({ url, token: MCP_TEST_TOKEN }, { allowPrivate: [] })).rejects.toThrow(/private/);
});

it("reads Composio's toolkits page by page, with its notice on every entry, and calls a tool", async () => {
	const client = new ComposioClient({ apiKey: env.COMPOSIO_API_KEY!, baseUrl: env.COMPOSIO_BASE_URL });
	const entries = await client.catalog();
	expect(entries.map((e) => e.id)).toEqual(["gmail", "workday", "xero"]);
	expect(entries.every((e) => e.notice === COMPOSIO_NOTICE)).toBe(true);
	expect(entries.find((e) => e.id === "workday")?.category).toBe("hr");
	const started = await client.connect("ac_gmail", "acct-a", "https://bots.knightcode.dev/connected");
	expect(started.redirectUrl).toContain(started.connectionId);
	expect(await client.execute("GMAIL_LIST_THREADS", { connectionId: started.connectionId, userId: "acct-a", args: { max: 5 } })).toMatchObject({
		tool: "GMAIL_LIST_THREADS",
	});
});

it("indexes only safe plugins with HTTPS servers, recording but never running local parts", async () => {
	const files: Record<string, unknown> = {
		".claude-plugin/marketplace.json": {
			plugins: [
				{ name: "linear", source: "./plugins/linear", description: "Issues" },
				{ name: "escape", source: "../outside" },
				{ name: "bad name!", source: "./plugins/x" },
				{ name: "local-only", source: "./plugins/local-only" },
			],
		},
		"plugins/linear/.mcp.json": { mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } } },
		"plugins/local-only/.mcp.json": { mcpServers: { tool: { command: "node", args: ["server.js"] } } },
		"plugins/local-only/.claude-plugin/plugin.json": { hooks: { PreToolUse: [] } },
	};
	const fetcher = async (url: string) => {
		const path = url.replace(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/HEAD\//, "");
		return path in files ? Response.json(files[path]) : new Response("not found", { status: 404 });
	};
	const plugins = await indexMarketplace("owner/marketplace", fetcher);
	expect(plugins.map((plugin) => plugin.entry.id)).toEqual(["linear", "local-only"]);
	expect(plugins[0]!.servers).toEqual([{ name: "linear", url: "https://mcp.linear.app/mcp" }]);
	expect(plugins[1]!.servers).toEqual([]);
	expect(plugins[1]!.inert).toEqual(["local MCP server tool", "hooks"]);
	expect([safePath("../x"), safePath("/etc"), safePath("a/../b"), safePath("./plugins/ok")]).toEqual([undefined, undefined, undefined, "plugins/ok"]);
});

it("gates connector tools by their permission and keeps MCP App panels offline", () => {
	const read = { name: "list_issues", annotations: { readOnlyHint: true } };
	const write = { name: "create_issue", annotations: { readOnlyHint: false } };
	const unmarked = { name: "mystery" };
	expect([permissionFor(DEFAULT_PERMISSIONS, read), permissionFor(DEFAULT_PERMISSIONS, write), permissionFor(DEFAULT_PERMISSIONS, unmarked)]).toEqual([
		"auto",
		"approval",
		"approval",
	]);
	const tuned = { ...DEFAULT_PERMISSIONS, tools: { list_issues: "blocked" as const } };
	expect(connectorGate(permissionFor(tuned, read))).toBe("refuse");
	expect(panelPolicy("https://bots.knightcode.dev")).toMatch(/connect-src 'none'/);
	expect(panelPolicy("https://bots.knightcode.dev")).toMatch(/frame-ancestors https:\/\/bots\.knightcode\.dev/);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** OAuth discovery on a public host that redirects to `target`; records every request that reaches the network. */
function emulatorRedirectTo(target: string) {
	const fetched: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = input instanceof Request ? input.url : String(input);
		fetched.push(url);
		return new Response(null, { status: 302, headers: { location: target } });
	}) as typeof fetch;
	return {
		url: "https://auth.example/.well-known/oauth-authorization-server",
		policy: { allowPrivate: [], resolve: async () => ["93.184.216.34"] },
		fetched,
	};
}

/** A request with a bearer token to https://a.example/start, redirected to `next`; the headers each hop saw. */
async function fetchThroughRedirectWithBearer(next: string) {
	const seen: Record<string, Record<string, string>> = {};
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		const headers = Object.fromEntries(new Headers(init?.headers).entries());
		if (url === "https://a.example/start") {
			seen.firstHop = headers;
			return new Response(null, { status: 302, headers: { location: next } });
		}
		seen.secondHop = headers;
		return new Response("ok");
	}) as typeof fetch;
	await guardedFetch(
		"https://a.example/start",
		{ headers: { authorization: "Bearer secret-token" } },
		{ allowPrivate: [], resolve: async () => ["93.184.216.34"] },
	);
	return seen as { firstHop: Record<string, string>; secondHop: Record<string, string> };
}

const entry = (id: string, description: string): CatalogEntry => ({
	id,
	name: id[0]!.toUpperCase() + id.slice(1),
	maker: id,
	category: "productivity",
	icon: "",
	description,
	auth: "oauth",
	skills: [],
	permissions: DEFAULT_PERMISSIONS,
});
const curated = (ids: string[]): CatalogSource => ({ kind: "curated", entries: ids.map((id) => entry(id, "from curated")) });
const plugins = (ids: string[]): CatalogSource => ({ kind: "plugins", entries: ids.map((id) => entry(id, "from plugins")) });
const composio = (ids: string[]): CatalogSource => ({ kind: "composio", entries: ids.map((id) => entry(id, "from composio")) });

it("lists Gmail (Composio), HubSpot and Notion in one catalog; a Composio app connects on Composio's page and is revoked on disconnect", async () => {
	const user = env.USER.get(env.USER.idFromName("acct-catalog"));
	await runInDurableObject(user, async (instance) => {
		const object = instance as unknown as UserObject;
		const catalog = await object.catalog();
		for (const id of ["gmail", "hubspot", "notion"]) expect(catalog.map((entry) => entry.id)).toContain(id);
		const connected = await object.connectApp("gmail", { skills: false });
		expect(connected.authorizeUrl).toMatch(/\/connect\/ca_\d+\?next=/);
		expect(connected.entry.connection?.status).toBe("connected");
		const held = () => env.DB.prepare("SELECT app_id FROM composio_accounts WHERE account_id = ?").bind("acct-catalog").all<{ app_id: string }>();
		expect((await held()).results).toEqual([{ app_id: "gmail" }]);
		// An app with its own server connects without Composio.
		expect((await object.connectApp("notion", { skills: false })).authorizeUrl).toBeUndefined();
		await object.disconnectApp("gmail");
		expect((await held()).results).toEqual([]);
	});
});
