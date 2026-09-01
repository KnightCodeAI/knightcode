import type { AgentTool } from "@knightcode/agent";
import { fauxAssistantMessage, fauxToolCall } from "@knightcode/ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

describe("issue #8581 image-only queue entry", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("removes an image-only steering message from the queue after delivery", async () => {
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return { content: [{ type: "text", text: "released" }], details: {} };
			},
		};

		const harness = await createHarness({ tools: [waitTool] });
		harnesses.push(harness);

		const waitForToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsubscribe();
					resolve();
				}
			});
		});

		let sawImage = false;
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				const user = [...context.messages].reverse().find((message) => message.role === "user");
				sawImage =
					user?.role === "user" &&
					typeof user.content !== "string" &&
					user.content.some((part) => part.type === "image");
				return fauxAssistantMessage("done");
			},
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForToolStart;
		await harness.session.steer("", [{ type: "image", mimeType: "image/png", data: "ZmFrZQ==" }]);
		expect(harness.session.pendingMessageCount).toBe(1);
		releaseToolExecution?.();
		await promptPromise;

		expect(sawImage).toBe(true);
		expect(harness.session.agent.hasQueuedMessages()).toBe(false);
		expect(harness.session.pendingMessageCount).toBe(0);
	});
});
