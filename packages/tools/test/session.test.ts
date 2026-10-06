import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@knightcode/ai/compat";
import type { ExtensionFactory } from "@knightcodeai/cli";
import { ENV_AGENT_DIR } from "@knightcodeai/cli/config";
import { DefaultResourceLoader } from "@knightcodeai/cli/core/resource-loader";
import { createAgentSession } from "@knightcodeai/cli/core/sdk";
import { SessionManager } from "@knightcodeai/cli/core/session-manager";
import { SettingsManager } from "@knightcodeai/cli/core/settings-manager";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import toolsExtension from "../src/index.ts";
import { writePersisted } from "../src/state.ts";
import { probeExtension, seenAtSessionStart } from "./probe-extension.ts";

/**
 * Boots a real AgentSession with the given inline extensions, the way the engine's own
 * dynamic-tool tests do. No model call is made; the model only has to exist in the catalogue.
 */
export async function bootSession(
	extensionFactories: ExtensionFactory[],
	tempDir: string,
	agentDir: string,
	tools?: string[],
) {
	const settingsManager = SettingsManager.create(tempDir, agentDir);
	const sessionManager = SessionManager.inMemory(tempDir);
	const resourceLoader = new DefaultResourceLoader({ cwd: tempDir, agentDir, settingsManager, extensionFactories });
	await resourceLoader.reload();
	const model = getModel("anthropic", "claude-sonnet-4-5")!;
	const { session } = await createAgentSession({
		cwd: tempDir,
		agentDir,
		model,
		settingsManager,
		sessionManager,
		resourceLoader,
		tools,
	});
	return session;
}

describe("engine ordering", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `knightcode-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
		seenAtSessionStart.length = 0;
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	test("an extension tool is active and visible to getActiveTools when session_start fires", async () => {
		const session = await bootSession([probeExtension], tempDir, agentDir);
		await session.bindExtensions({});
		expect(session.agent.state.tools.map((t) => t.name)).toContain("probe");
		expect(seenAtSessionStart).toHaveLength(1);
		expect(seenAtSessionStart[0]).toContain("probe");
	});

	test("the real extension registers its tools but leaves them off by default", async () => {
		process.env[ENV_AGENT_DIR] = agentDir;
		try {
			const session = await bootSession([toolsExtension], tempDir, agentDir);
			await session.bindExtensions({});
			const names = session.agent.state.tools.map((t) => t.name);
			expect(names).not.toContain("webfetch");
			expect(names).not.toContain("websearch");
			expect(names).not.toContain("ask_user");
			expect(session.getAllTools().map((t) => t.name)).toEqual(
				expect.arrayContaining(["webfetch", "websearch", "ask_user"]),
			);
		} finally {
			delete process.env[ENV_AGENT_DIR];
		}
	});

	test("a tool named in --tools stays active although /tools never enabled it", async () => {
		process.env[ENV_AGENT_DIR] = agentDir;
		try {
			const session = await bootSession([toolsExtension], tempDir, agentDir, ["read", "ask_user"]);
			await session.bindExtensions({});
			expect(session.agent.state.tools.map((t) => t.name)).toEqual(["read", "ask_user"]);
		} finally {
			delete process.env[ENV_AGENT_DIR];
		}
	});

	test("a tool named in defaultTools stays active although /tools never enabled it", async () => {
		process.env[ENV_AGENT_DIR] = agentDir;
		try {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["+ask_user"] }));
			const session = await bootSession([toolsExtension], tempDir, agentDir);
			await session.bindExtensions({});
			expect(session.agent.state.tools.map((t) => t.name)).toContain("ask_user");
		} finally {
			delete process.env[ENV_AGENT_DIR];
		}
	});

	test("session_start keeps a registry tool another extension activated first", async () => {
		process.env[ENV_AGENT_DIR] = agentDir;
		// Stands in for plan mode, which activates ask_user for planning and loads before the tools extension.
		const activator: ExtensionFactory = (pi) => {
			pi.on("session_start", () => pi.setActiveTools([...pi.getActiveTools(), "ask_user"]));
		};
		try {
			const session = await bootSession([activator, toolsExtension], tempDir, agentDir);
			await session.bindExtensions({});
			expect(session.agent.state.tools.map((t) => t.name)).toContain("ask_user");
		} finally {
			delete process.env[ENV_AGENT_DIR];
		}
	});

	test("a tool turned off in tools.json is dropped even when --tools names it", async () => {
		process.env[ENV_AGENT_DIR] = agentDir;
		try {
			writePersisted({ ask_user: { enabled: false } }, join(agentDir, "tools.json"));
			const session = await bootSession([toolsExtension], tempDir, agentDir, ["read", "ask_user"]);
			await session.bindExtensions({});
			expect(session.agent.state.tools.map((t) => t.name)).toEqual(["read"]);
		} finally {
			delete process.env[ENV_AGENT_DIR];
		}
	});

	test("a persisted on in tools.json adds the tool at session start", async () => {
		process.env[ENV_AGENT_DIR] = agentDir;
		try {
			writePersisted({ webfetch: { enabled: true } }, join(agentDir, "tools.json"));
			const session = await bootSession([toolsExtension], tempDir, agentDir);
			await session.bindExtensions({});
			const names = session.agent.state.tools.map((t) => t.name);
			expect(names).toContain("webfetch");
			expect(names).not.toContain("websearch");
		} finally {
			delete process.env[ENV_AGENT_DIR];
		}
	});
});
