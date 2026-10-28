import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@knightcode/ai";
import { type JsonRpcRequest, LATEST_PROTOCOL_VERSION } from "@knightcode/mcp";
import { createInMemoryTransportPair } from "@knightcode/mcp/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionFactory } from "../../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { ProjectTrustStore } from "../../src/core/trust-manager.ts";
import { builtInExtensions, MCP_BUILTIN_EXTENSIONS } from "../../src/extensions/index.ts";
import type { McpServerEntry } from "../../src/extensions/mcp/config.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { createPluginsExtension } from "../../src/extensions/plugins/index.ts";
import { createPluginMcpExtension } from "../../src/extensions/plugins/mcp.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { writeTree } from "../plugins/helpers.ts";
import { createHarness, createTestUiContext, getUserTexts, type Harness } from "./harness.ts";

const dirs: string[] = [];
const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length) harnesses.pop()?.cleanup();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "kc-plugin-suite-"));
	dirs.push(dir);
	return dir;
}

const PLUGIN = {
	"plugin.json": {
		name: "demo",
		skills: ["./skills/fix", "./skills/solo.md"],
		mcpServers: { docs: { command: "docs-server" } },
	},
	"skills/fix/SKILL.md":
		"---\ndescription: Fix things\narguments: [target]\nargument-hint: <target>\n---\nFix $target carefully.\n",
	"skills/solo.md": "---\ndescription: Solo\n---\nSolo body\n",
	"skills/stray.md": "---\ndescription: Not declared\n---\n",
	"skills/other/SKILL.md": "---\ndescription: Not declared either\n---\n",
	"commands/go.md": "---\ndescription: Go somewhere\nargument-hint: <place> <then>\n---\nGo to $0 then $1.\n",
	"commands/plain.md": "Review the code.\n",
};

async function installDemo(agentDir: string, files: Record<string, string | object> = PLUGIN) {
	const source = writeTree(tempDir(), files);
	await new PluginManager({ agentDir, cwd: agentDir }).install(source, { trust: true });
	return source;
}

function fakeMcpServer() {
	const pair = createInMemoryTransportPair();
	const respond = (request: JsonRpcRequest): unknown => {
		if (request.method === "initialize") {
			return {
				protocolVersion: LATEST_PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: "d", version: "1" },
			};
		}
		if (request.method === "tools/list") {
			return { tools: [{ name: "search", description: "Search.", inputSchema: { type: "object", properties: {} } }] };
		}
		return {};
	};
	pair.server.onMessage((message) => {
		if (!("id" in message) || !("method" in message)) return;
		const request = message as JsonRpcRequest;
		queueMicrotask(() => void pair.server.send({ jsonrpc: "2.0", id: request.id, result: respond(request) }));
	});
	void pair.server.start();
	return pair.client;
}

/** A session whose resource loader is the real one, so `/reload` builds fresh extension instances. */
async function setup(agentDir: string, extra: ExtensionFactory[] = [], options: { noSkills?: boolean } = {}) {
	const resourceLoader = new DefaultResourceLoader({
		cwd: tempDir(),
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		extensionFactories: [createPluginsExtension({ agentDir }), ...extra],
		...options,
	});
	await resourceLoader.reload();
	const harness = await createHarness({ resourceLoader });
	harnesses.push(harness);
	await harness.session.bindExtensions({ uiContext: createTestUiContext() });
	return harness;
}

describe("plugin commands", () => {
	it("send commands and skills in the plugin dialect and keep /skill: native", async () => {
		const agentDir = tempDir();
		await installDemo(agentDir);
		const harness = await setup(agentDir);
		const names = harness.session.extensionRunner.getRegisteredCommands().map((command) => command.invocationName);
		expect(names).toEqual(expect.arrayContaining(["demo:fix", "demo:solo", "demo:go", "demo:plain"]));
		// Autocomplete draws a hint as "<hint> — <description>"; extension commands carry it in the description.
		const description = (name: string) => harness.session.extensionRunner.getCommand(name)?.description;
		expect(description("demo:go")).toBe("<place> <then> — Go somewhere");
		expect(description("demo:fix")).toBe("<target> — Fix things");
		expect(description("demo:plain")).toBe("Review the code.");
		harness.setResponses([fauxAssistantMessage("a"), fauxAssistantMessage("b"), fauxAssistantMessage("c")]);
		await harness.session.prompt(`/demo:go "the moon" back\\ home`);
		await harness.session.prompt("/demo:plain src/x.ts");
		await harness.session.prompt("/demo:fix 'the bug'");
		const texts = getUserTexts(harness);
		expect(texts[0]).toBe("Go to the moon then back home.");
		expect(texts[1]).toBe("Review the code.\n\nARGUMENTS: src/x.ts");
		expect(texts[2]).toMatch(/^<skill name="demo:fix" location=".*SKILL\.md">/);
		expect(texts[2]).toContain("Fix the bug carefully.");
	});

	it("reports acceptance and queues a command while the agent is busy", async () => {
		const agentDir = tempDir();
		await installDemo(agentDir);
		const harness = await setup(agentDir);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		harness.setResponses([
			async () => {
				await gate;
				return fauxAssistantMessage("first");
			},
			fauxAssistantMessage("second"),
		]);
		const dispositions: string[] = [];
		const first = harness.session.prompt("/demo:plain", { preflightResult: (d) => dispositions.push(d) });
		await vi.waitFor(() => expect(dispositions).toEqual(["started"]));
		await harness.session.prompt("/demo:go a b", { preflightResult: (d) => dispositions.push(d) });
		expect(dispositions).toEqual(["started", "queued"]);
		release();
		await first;
		await vi.waitFor(() => expect(getUserTexts(harness)).toContain("Go to a then b."));
	});

	it("drops a disabled plugin's commands on reload and isolates projects", async () => {
		const agentDir = tempDir();
		await installDemo(agentDir);
		const project = tempDir();
		const harness = await setup(agentDir);
		expect(harness.session.extensionRunner.getCommand("demo:go")).toBeDefined();
		await new PluginManager({ agentDir, cwd: agentDir }).setEnabled("demo", false, {});
		await harness.session.reload();
		expect(harness.session.extensionRunner.getCommand("demo:go")).toBeUndefined();

		new ProjectTrustStore(agentDir).set(project, true);
		const local = writeTree(tempDir(), { "plugin.json": { name: "local-only" }, "commands/hi.md": "hi" });
		await new PluginManager({ agentDir, cwd: project }).install(local, { scope: "project", trust: true });
		const elsewhere = await setup(agentDir);
		expect(elsewhere.session.extensionRunner.getCommand("local-only:hi")).toBeUndefined();
	});
});

describe("plugin skills", () => {
	it("load exactly the declared skill files and work through /skill:", async () => {
		const agentDir = tempDir();
		await installDemo(agentDir);
		// --no-skills keeps its meaning for extension-contributed skills: plugin skills still load.
		const harness = await setup(agentDir, [], { noSkills: true });
		const skills = harness.session.resourceLoader.getSkills();
		expect(skills.skills.map((skill) => skill.name).sort()).toEqual(["demo:fix", "demo:solo"]);
		expect(skills.diagnostics).toEqual([]);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:demo:fix the bug");
		const [text] = getUserTexts(harness);
		// Native semantics: the arguments follow the block, and $target is not substituted.
		expect(text).toContain("Fix $target carefully.");
		expect(text?.endsWith("</skill>\n\nthe bug")).toBe(true);
	});
});

describe("plugin MCP servers", () => {
	it("register under plugin names and connect through the MCP extension", async () => {
		const agentDir = tempDir();
		await installDemo(agentDir);
		const connected: McpServerEntry[] = [];
		const harness = await setup(agentDir, [
			createMcpExtension({
				loadConfig: () => ({ servers: [], errors: [] }),
				createTransport: (entry) => {
					connected.push(entry);
					return fakeMcpServer();
				},
			}),
			createPluginMcpExtension({ agentDir }),
		]);
		await vi.waitFor(() => expect(connected.map((entry) => entry.name)).toEqual(["plugin_demo_docs"]));
		expect(connected[0]?.config).toMatchObject({ command: "docs-server" });
		await vi.waitFor(() =>
			expect(harness.session.getAllTools().some((tool) => tool.name === "mcp__plugin_demo_docs__search")).toBe(true),
		);
		await new PluginManager({ agentDir, cwd: agentDir }).setEnabled("demo", false, {});
		await harness.session.reload();
		expect(harness.session.getAllTools().some((tool) => tool.name === "mcp__plugin_demo_docs__search")).toBe(false);
	});

	it("are left out with --no-mcp without errors", async () => {
		const agentDir = tempDir();
		await installDemo(agentDir);
		const cwd = tempDir();
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			extensionFactories: builtInExtensions,
			disabledBuiltinExtensions: MCP_BUILTIN_EXTENSIONS,
		});
		await resourceLoader.reload();
		const paths = resourceLoader.getExtensions().extensions.map((extension) => extension.path);
		expect(paths).toContain("builtin:plugins");
		expect(paths).not.toContain("builtin:plugin-mcp");
		expect(paths).not.toContain("builtin:mcp");
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const none = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			extensionFactories: builtInExtensions,
			noExtensions: true,
		});
		await none.reload();
		expect(none.getExtensions().extensions.map((extension) => extension.path)).not.toContain("builtin:plugins");
	});
});
