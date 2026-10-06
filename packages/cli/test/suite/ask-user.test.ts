import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@knightcode/ai";
import toolsExtension from "@knightcode/tools";
import { INTERRUPTED_TEXT, NO_USER_TEXT } from "@knightcode/tools/ask/tool";
import { resetSessionOverrides, setMode } from "@knightcode/tools/state";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/index.ts";
import { createHarness, createTestUiContext, getMessageText, getToolResult, type Harness } from "./harness.ts";

const questions = [
	{
		id: "database",
		question: "Which database should the cache use?",
		options: [
			{ label: "SQLite (Recommended)", description: "One file, no server." },
			{ label: "Postgres", description: "Needs a running server." },
		],
	},
];

describe("ask_user", () => {
	const harnesses: Harness[] = [];
	const cleanupDirs: string[] = [];

	afterEach(() => {
		resetSessionOverrides();
		delete process.env[ENV_AGENT_DIR];
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		while (cleanupDirs.length > 0) rmSync(cleanupDirs.pop() ?? "", { recursive: true, force: true });
	});

	/** A session with ask_user enabled; the model asks once, then replies "done" once it has the answer. */
	async function start(ui?: Partial<ExtensionUIContext>): Promise<Harness> {
		// tools.json is read from the agent dir; point it at an empty temp dir so the user's own is never read.
		const agentDir = mkdtempSync(join(tmpdir(), "kc-ask-agent-"));
		cleanupDirs.push(agentDir);
		process.env[ENV_AGENT_DIR] = agentDir;
		await setMode("ask_user", "session");
		const harness = await createHarness({ extensionFactories: [toolsExtension] });
		harnesses.push(harness);
		// Binding fires session_start, which is where the tools extension activates enabled tools.
		await harness.session.bindExtensions(ui ? { uiContext: createTestUiContext(ui) } : {});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask_user", { questions })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		return harness;
	}

	it("is declared once enabled", async () => {
		const harness = await start();
		await harness.session.prompt("pick a database");
		expect(harness.session.agent.state.tools.map((t) => t.name)).toContain("ask_user");
	});

	it("with no user, returns the assumption text and the run continues", async () => {
		const harness = await start();
		await harness.session.prompt("pick a database");
		expect(getMessageText(getToolResult(harness, "ask_user"))).toBe(NO_USER_TEXT);
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(getMessageText(harness.session.messages.at(-1))).toBe("done");
	});

	it("a dialog answer reaches the model", async () => {
		const harness = await start({ select: async (_title, rows) => rows[1] });
		await harness.session.prompt("pick a database");
		expect(getMessageText(getToolResult(harness, "ask_user"))).toBe("database: Postgres");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("cancelling the dialog interrupts the run before the next request", async () => {
		const harness = await start({ select: async () => undefined });
		await harness.session.prompt("pick a database");
		const result = getToolResult(harness, "ask_user");
		expect(getMessageText(result)).toBe(INTERRUPTED_TEXT);
		expect(result.isError).toBe(false);
		// No model call followed: the "done" reply was never requested, not even as an aborted stream.
		expect(harness.getPendingResponseCount()).toBe(1);
		expect(harness.session.messages.at(-1)).toBe(result);
	});
});
