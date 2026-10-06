import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@knightcode/ai";
import toolsExtension from "@knightcode/tools";
import { INTERRUPTED_TEXT, NO_USER_TEXT } from "@knightcode/tools/ask/tool";
import { resetSessionOverrides, setMode } from "@knightcode/tools/state";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/index.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
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

	/**
	 * A session with ask_user enabled; the model asks once, then replies "done" once it has the answer.
	 * `requests` holds the serialized context of that second request, which is what the model saw.
	 */
	async function start(
		ui?: Partial<ExtensionUIContext>,
		sessionManager?: SessionManager,
	): Promise<{ harness: Harness; requests: string[] }> {
		// tools.json is read from the agent dir; point it at an empty temp dir so the user's own is never read.
		const agentDir = mkdtempSync(join(tmpdir(), "kc-ask-agent-"));
		cleanupDirs.push(agentDir);
		process.env[ENV_AGENT_DIR] = agentDir;
		await setMode("ask_user", "session");
		const harness = await createHarness({ extensionFactories: [toolsExtension], sessionManager });
		harnesses.push(harness);
		// Binding fires session_start, which is where the tools extension activates enabled tools.
		await harness.session.bindExtensions(ui ? { uiContext: createTestUiContext(ui) } : {});
		const requests: string[] = [];
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("ask_user", { questions }, { id: "ask-1" })], { stopReason: "toolUse" }),
			(context) => {
				requests.push(JSON.stringify(context));
				return fauxAssistantMessage("done");
			},
		]);
		return { harness, requests };
	}

	it("is declared once enabled", async () => {
		const { harness } = await start();
		await harness.session.prompt("pick a database");
		expect(harness.session.agent.state.tools.map((t) => t.name)).toContain("ask_user");
	});

	it("with no user, returns the assumption text and the run continues", async () => {
		const { harness, requests } = await start();
		await harness.session.prompt("pick a database");
		expect(getMessageText(getToolResult(harness, "ask_user"))).toBe(NO_USER_TEXT);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain(NO_USER_TEXT);
		expect(getMessageText(harness.session.messages.at(-1))).toBe("done");
	});

	it("a dialog answer reaches the model", async () => {
		const { harness, requests } = await start({ select: async (_title, rows) => rows[1] });
		await harness.session.prompt("pick a database");
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain("database: Postgres");
	});

	it("the HTML export shows the outcome in the call row", async () => {
		initTheme("dark");
		const dir = mkdtempSync(join(tmpdir(), "kc-ask-export-"));
		cleanupDirs.push(dir);
		const { harness } = await start(
			{ select: async (_title, rows) => rows[1] },
			SessionManager.create(dir, join(dir, "sessions")),
		);
		await harness.session.prompt("pick a database");
		const html = readFileSync(await harness.session.exportToHtml(join(dir, "export.html")), "utf8");
		const data = /<script id="session-data" type="application\/json">([^<]*)<\/script>/.exec(html)?.[1] ?? "";
		const rendered = JSON.parse(Buffer.from(data, "base64").toString("utf8")).renderedTools?.["ask-1"];
		expect(stripAnsi(rendered?.callHtml ?? "")).toContain("1/1 answered");
		expect(stripAnsi(rendered?.resultHtmlExpanded ?? "")).toContain("Postgres");
	});

	it("cancelling the dialog interrupts the run before the next request", async () => {
		const { harness } = await start({ select: async () => undefined });
		await harness.session.prompt("pick a database");
		const result = getToolResult(harness, "ask_user");
		expect(getMessageText(result)).toBe(INTERRUPTED_TEXT);
		expect(result.isError).toBe(false);
		// No model call followed: the "done" reply was never requested, not even as an aborted stream.
		expect(harness.getPendingResponseCount()).toBe(1);
		expect(harness.session.messages.at(-1)).toBe(result);
	});
});
