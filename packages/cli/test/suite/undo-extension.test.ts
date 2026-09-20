import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@knightcode/ai";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../../src/config.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { createEditTool } from "../../src/core/tools/edit.ts";
import { createWriteTool } from "../../src/core/tools/write.ts";
import undoExtension from "../../src/extensions/undo/index.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("undo extension", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		for (const harness of harnesses.splice(0)) harness.cleanup();
		delete process.env[ENV_AGENT_DIR];
	});

	async function setup(answer: string): Promise<Harness> {
		const harness = await createHarness({
			tools: [createEditTool(process.cwd()), createWriteTool(process.cwd())],
			extensionFactories: [undoExtension],
		});
		harnesses.push(harness);
		process.env[ENV_AGENT_DIR] = join(harness.tempDir, "agent");
		// Any explicit UI context makes hasUI true; the restore prompt answers itself.
		await harness.session.bindExtensions({
			uiContext: { select: async () => answer, notify: () => {} } as unknown as ExtensionUIContext,
		});
		return harness;
	}

	function firstUserEntryId(harness: Harness): string {
		const entry = harness.sessionManager
			.getEntries()
			.find((candidate) => candidate.type === "message" && candidate.message.role === "user");
		if (!entry) throw new Error("no user entry");
		return entry.id;
	}

	it("restores an edited file when rewinding to the prompt that edited it", async () => {
		const harness = await setup("Conversation and 1 file");
		const file = join(harness.tempDir, "a.txt");
		writeFileSync(file, "hello world");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: file, edits: [{ oldText: "world", newText: "there" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("edited"),
		]);
		await harness.session.prompt("edit it");
		expect(readFileSync(file, "utf8")).toBe("hello there");

		const result = await harness.session.navigateTree(firstUserEntryId(harness));
		expect(result.editorText).toBe("edit it");
		expect(readFileSync(file, "utf8")).toBe("hello world");
	});

	it("deletes a file the rewound turn created", async () => {
		const harness = await setup("Conversation and 1 file");
		const file = join(harness.tempDir, "new.txt");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: file, content: "fresh" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("written"),
		]);
		await harness.session.prompt("create it");
		expect(existsSync(file)).toBe(true);

		await harness.session.navigateTree(firstUserEntryId(harness));
		expect(existsSync(file)).toBe(false);
	});

	it("leaves files alone when only the conversation is rewound", async () => {
		const harness = await setup("Conversation only");
		const file = join(harness.tempDir, "a.txt");
		writeFileSync(file, "hello world");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("edit", { path: file, edits: [{ oldText: "world", newText: "there" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("edited"),
		]);
		await harness.session.prompt("edit it");

		await harness.session.navigateTree(firstUserEntryId(harness));
		expect(readFileSync(file, "utf8")).toBe("hello there");
	});
});
