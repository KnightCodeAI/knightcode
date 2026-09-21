import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, getCurrentSystemPrompt } from "@knightcode/ai";
import toolsExtension from "@knightcode/tools";
import { openScratchpad, scratchpadDir } from "@knightcode/tools/scratchpad";
import { resetSessionOverrides, setMode } from "@knightcode/tools/state";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import { createHarness, getMessageText, type Harness, type HarnessOptions } from "./harness.ts";

describe("scratchpad", () => {
	const harnesses: Harness[] = [];
	const cleanupDirs: string[] = [];

	afterEach(() => {
		resetSessionOverrides();
		delete process.env[ENV_AGENT_DIR];
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		while (cleanupDirs.length > 0) rmSync(cleanupDirs.pop() ?? "", { recursive: true, force: true });
	});

	async function start(
		enabled: boolean,
		options: Pick<HarnessOptions, "models" | "settings"> = {},
	): Promise<{ harness: Harness; dir: string }> {
		// tools.json is read from the agent dir; point it at an empty temp dir so the user's own is never read.
		const agentDir = mkdtempSync(join(tmpdir(), "kc-scratchpad-agent-"));
		cleanupDirs.push(agentDir);
		process.env[ENV_AGENT_DIR] = agentDir;
		if (enabled) await setMode("scratchpad", "session");
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			...options,
			extensionFactories: [
				toolsExtension,
				// Compacts without a summary model call.
				(knightcode) => {
					knightcode.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "compacted",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
		});
		harnesses.push(harness);
		const dir = scratchpadDir(harness.sessionManager.getSessionId());
		cleanupDirs.push(dir);
		return { harness, dir };
	}

	it("names the session scratchpad in the system prompt and creates it", async () => {
		const { harness, dir } = await start(true);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		const prompt = getCurrentSystemPrompt(harness.session.messages);
		expect(prompt).toContain("<scratchpad>");
		expect(prompt).toContain(dir.replace(/\\/g, "/"));
		expect(existsSync(dir)).toBe(true);
	});

	it("restores notes.md after compaction", async () => {
		const { harness, dir } = await start(true);
		harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");
		writeFileSync(join(dir, "notes.md"), "- [ ] wire auth\n- mint.ts:42 mints the token\n");
		await harness.session.compact();
		const restored = harness.session.messages.filter(
			(message) => message.role === "custom" && message.customType === "scratchpad-notes",
		);
		expect(restored).toHaveLength(1);
		expect(getMessageText(restored[0])).toContain("mint.ts:42 mints the token");
	});

	it("restores notes.md after end-of-run compaction without starting another turn", async () => {
		// A one-token window makes the completed response overflow, so the session compacts after the run.
		const { harness, dir } = await start(true, {
			models: [{ id: "faux-1", contextWindow: 1, maxTokens: 100 }],
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
		});
		openScratchpad(harness.sessionManager.getSessionId());
		writeFileSync(join(dir, "notes.md"), "- mint.ts:42 mints the token\n");
		harness.setResponses([fauxAssistantMessage("done"), fauxAssistantMessage("unrequested")]);
		await harness.session.prompt("hi");
		expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({ reason: "overflow", aborted: false });
		expect(harness.faux.state.callCount).toBe(1);
		const restored = harness.session.messages.filter(
			(message) => message.role === "custom" && message.customType === "scratchpad-notes",
		);
		expect(restored).toHaveLength(1);
	});

	it("does nothing while disabled", async () => {
		const { harness, dir } = await start(false);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		expect(getCurrentSystemPrompt(harness.session.messages)).not.toContain("<scratchpad>");
		expect(existsSync(dir)).toBe(false);
	});
});
