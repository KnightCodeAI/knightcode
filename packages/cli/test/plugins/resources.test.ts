import { describe, expect, it } from "vitest";
import { loadSkills } from "../../src/core/skills.ts";
import { parsePluginArguments, substitutePluginArguments } from "../../src/plugins/arguments.ts";
import { translatePluginServers } from "../../src/plugins/mcp.ts";
import { useTempDirs, writeTree } from "./helpers.ts";

const tempDir = useTempDirs();

describe("plugin argument dialect", () => {
	it("parses quotes, backslash escapes, literal variables and drops shell operators", () => {
		expect(parsePluginArguments(`a "b c" 'd e' target\\ file.ts`)).toEqual(["a", "b c", "d e", "target file.ts"]);
		expect(parsePluginArguments("$HOME ${USER} x")).toEqual(["$HOME", "${USER}", "x"]);
		expect(parsePluginArguments("one | two && three; four > out")).toEqual(["one", "two", "three", "four", "out"]);
		expect(parsePluginArguments('say "a \\"quoted\\" word"')).toEqual(["say", 'a "quoted" word']);
		expect(parsePluginArguments("  ")).toEqual([]);
	});

	it("substitutes 0-indexed, ARGUMENTS[N], named and whole-string placeholders", () => {
		const args = `fix "src/a b.ts" fast`;
		expect(substitutePluginArguments("$0 on $1 ($2) $3.", args, [])).toBe("fix on src/a b.ts (fast) .");
		expect(substitutePluginArguments("$ARGUMENTS[1] / $ARGUMENTS", args, [])).toBe(`src/a b.ts / ${args}`);
		expect(substitutePluginArguments("Do $action to $file", args, ["action", "file"])).toBe("Do fix to src/a b.ts");
		expect(substitutePluginArguments("$actions stays", "", ["action"])).toBe("$actions stays");
	});

	it("appends the arguments when no placeholder appears, and only when there are arguments", () => {
		expect(substitutePluginArguments("Review the code.", "src/x.ts", [])).toBe(
			"Review the code.\n\nARGUMENTS: src/x.ts",
		);
		expect(substitutePluginArguments("Review the code.", "", [])).toBe("Review the code.");
		expect(substitutePluginArguments("Use $0.", "", [])).toBe("Use .");
	});
});

describe("plugin skill names", () => {
	it("load with a single <plugin>: prefix and no warning", () => {
		const root = writeTree(tempDir(), {
			"ok.md": "---\nname: my-plugin:fix-it\ndescription: d\n---\n",
			"bad.md": "---\nname: a:b:c\ndescription: d\n---\n",
		});
		const ok = loadSkills({ cwd: root, agentDir: root, skillPaths: [`${root}/ok.md`], includeDefaults: false });
		expect(ok.skills.map((skill) => skill.name)).toEqual(["my-plugin:fix-it"]);
		expect(ok.diagnostics).toEqual([]);
		const bad = loadSkills({ cwd: root, agentDir: root, skillPaths: [`${root}/bad.md`], includeDefaults: false });
		expect(bad.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toMatch(/invalid characters/);
	});
});

describe("plugin MCP translation", () => {
	const context = { root: "C:/plugins/p/rev/plugin", dataDir: "C:/plugins/data/p" };
	const translate = (servers: Record<string, unknown>, env: Record<string, string> = {}, namespace = "p") =>
		translatePluginServers([{ identity: "id", namespace, ...context, inventory: { mcpServers: servers } }], env);

	it("expands command, args, cwd and oauth fields at registration and adds the plugin root variables", () => {
		const { servers, diagnostics } = translate(
			{
				run: {
					command: "${CLAUDE_PLUGIN_ROOT}/bin/${TOOL:-server}",
					args: ["--data", "${GROK_PLUGIN_DATA}", "--mode=${MODE}"],
					cwd: "${CLAUDE_PLUGIN_ROOT}",
					env: {
						KEY: "${API_KEY}",
						PATHS: "${CLAUDE_PLUGIN_ROOT}/x",
						PRICE: "$5",
						CMD: "!rm -rf /",
						LEVEL: "${LEVEL:-high}",
					},
				},
				web: {
					url: "https://example.com/${REGION:-us}/mcp",
					headers: { Authorization: "Bearer ${TOKEN}", "X-Cost": "$$" },
					oauth: { clientId: "${CLIENT_ID}", clientSecret: "!echo secret" },
				},
			},
			{ MODE: "fast", CLIENT_ID: "cid" },
		);
		expect(diagnostics).toEqual([]);
		expect(servers.map((server) => server.name)).toEqual(["plugin_p_run", "plugin_p_web"]);
		expect(servers[0]?.config).toEqual({
			command: "C:/plugins/p/rev/plugin/bin/server",
			args: ["--data", "C:/plugins/data/p", "--mode=fast"],
			cwd: "C:/plugins/p/rev/plugin",
			env: {
				KEY: "${API_KEY}",
				PATHS: "C:/plugins/p/rev/plugin/x",
				PRICE: "$$5",
				CMD: "$!rm -rf /",
				LEVEL: "high",
				CLAUDE_PLUGIN_ROOT: "C:/plugins/p/rev/plugin",
				CLAUDE_PLUGIN_DATA: "C:/plugins/data/p",
				GROK_PLUGIN_ROOT: "C:/plugins/p/rev/plugin",
				GROK_PLUGIN_DATA: "C:/plugins/data/p",
			},
		});
		expect(servers[1]?.config).toEqual({
			url: "https://example.com/us/mcp",
			headers: { Authorization: "Bearer ${TOKEN}", "X-Cost": "$$$$" },
			oauth: { clientId: "cid", clientSecret: "$!echo secret" },
		});
	});

	it("leaves a server unregistered when a variable it needs at registration is missing", () => {
		const { servers, diagnostics } = translate({ run: { command: "${MISSING_BIN}" } });
		expect(servers).toEqual([]);
		expect(diagnostics.join("\n")).toMatch(/MISSING_BIN/);
	});

	it("maps Grok fields", () => {
		const { servers } = translate({
			grok: {
				url_template: "https://api.example.com/mcp",
				bearer_token_env_var: "GROK_TOKEN",
				oauth_client_id: "client",
				oauth_client_secret_env_var: "SECRET",
				oauth_scopes: ["read", "write"],
			},
			nested: { urlTemplate: "https://b.example.com", oauth: { clientSecretEnvVar: "S2", scopes: ["a"] } },
		});
		expect(servers[0]?.config).toEqual({
			url: "https://api.example.com/mcp",
			headers: { Authorization: "Bearer ${GROK_TOKEN}" },
			oauth: { clientId: "client", clientSecret: "${SECRET}", scope: "read write" },
		});
		expect(servers[1]?.config).toEqual({
			url: "https://b.example.com",
			oauth: { clientSecret: "${S2}", scope: "a" },
		});
	});

	it("blocks authentication KnightCode does not implement, provider credentials, SSE and WebSocket", () => {
		const { servers, diagnostics } = translate({
			file: { url: "https://a.example.com", bearer_token_file: "/tmp/token" },
			setup: { url: "https://a.example.com", setup: { command: "login" } },
			helper: { url: "https://a.example.com", headersHelper: "./h.sh" },
			xaa: { url: "https://a.example.com", oauth: { xaa: true } },
			provider: { url: "https://a.example.com", auth: { provider: "anthropic" } },
			sse: { type: "sse", url: "https://a.example.com/sse" },
			ws: { type: "ws", url: "wss://a.example.com" },
		});
		expect(servers).toEqual([]);
		const text = diagnostics.join("\n");
		for (const field of ["bearer_token_file", "setup", "headersHelper", "oauth.xaa", "auth.provider", "sse", "ws"]) {
			expect(text).toContain(field);
		}
	});

	it("warns about unknown fields but registers the server", () => {
		const { servers, diagnostics } = translate({ s: { command: "x", alwaysLoad: true } });
		expect(servers).toHaveLength(1);
		expect(diagnostics.join("\n")).toMatch(/alwaysLoad/);
	});

	it("leaves identical and namespace-equivalent names unregistered, naming both sources", () => {
		const { servers, diagnostics } = translatePluginServers(
			[
				{ identity: "first", namespace: "a-b", ...context, inventory: { mcpServers: { s: { command: "x" } } } },
				{ identity: "second", namespace: "a_b", ...context, inventory: { mcpServers: { s: { command: "y" } } } },
				{ identity: "third", namespace: "c", ...context, inventory: { mcpServers: { s: { command: "z" } } } },
			],
			{},
		);
		expect(servers.map((server) => server.name)).toEqual(["plugin_c_s"]);
		expect(diagnostics.join("\n")).toMatch(/first/);
		expect(diagnostics.join("\n")).toMatch(/second/);
	});
});
