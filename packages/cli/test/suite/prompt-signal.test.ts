import { fauxAssistantMessage } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => harness?.cleanup());

test("an aborted signal stops prompt() before a command runs", async () => {
	let ran = false;
	const command = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("noop", {
			description: "Records that it ran",
			handler: async () => {
				ran = true;
			},
		});
	harness = await createHarness({ extensionFactories: [command] });
	const controller = new AbortController();
	controller.abort();
	const dispositions: string[] = [];
	await harness.session.prompt("/noop", { signal: controller.signal, preflightResult: (d) => dispositions.push(d) });
	expect(ran).toBe(false);
	// The core reports a cancelled start as handled; the app server tells the two apart by its own signal.
	expect(dispositions).toEqual(["handled"]);
});

test("a command's ctx.sendUserMessage carries the outer signal into the prompt it starts", async () => {
	const controller = new AbortController();
	const command = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("dispatch", {
			description: "Aborts the outer signal, then dispatches a prompt",
			handler: async (_args, ctx) => {
				controller.abort();
				await ctx.sendUserMessage("nested");
			},
		});
	harness = await createHarness({ extensionFactories: [command] });
	harness.setResponses([fauxAssistantMessage("should not run")]);
	const dispositions: string[] = [];
	await harness.session.prompt("/dispatch", {
		signal: controller.signal,
		preflightResult: (d) => dispositions.push(d),
	});
	expect(dispositions).toEqual(["handled"]);
	expect(harness.getPendingResponseCount()).toBe(1);
	expect(harness.session.isIdle).toBe(true);
});
