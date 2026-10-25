import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@knightcode/ai";
import { afterEach, describe, expect, it } from "vitest";
import { BACKGROUND_SHELL_MESSAGE_TYPE, offersBackgroundShells } from "../../src/core/background-shells.ts";
import type { CustomMessage } from "../../src/core/messages.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createBashToolDefinition } from "../../src/core/tools/bash.ts";
import { createHarness, getAssistantTexts, getMessageText, type Harness } from "./harness.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backgroundMessages(harness: Harness): CustomMessage[] {
	return harness.session.messages.filter(
		(message): message is CustomMessage =>
			message.role === "custom" && message.customType === BACKGROUND_SHELL_MESSAGE_TYPE,
	);
}

/** A shell command that runs `then` once `path` exists, so the test decides when it ends. */
function waitForFile(path: string, then: string): string {
	return `while [ ! -f '${path.replace(/\\/g, "/")}' ]; do sleep 0.05; done; ${then}`;
}

function startBackground(command: string) {
	return fauxAssistantMessage([fauxToolCall("bash", { command, run_in_background: true })], { stopReason: "toolUse" });
}

describe("AgentSession background shell commands", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function create(options?: Parameters<typeof createHarness>[0]): Promise<Harness> {
		const harness = await createHarness(options);
		harnesses.push(harness);
		return harness;
	}

	it("activates task_stop with the shell tools, even under a tool allowlist", async () => {
		const defaults = await create();
		expect(defaults.session.getActiveToolNames()).toEqual(expect.arrayContaining(["bash", "task_stop"]));

		const allowlisted = await create({ allowedToolNames: ["read", "bash"] });
		expect(allowlisted.session.getActiveToolNames()).toEqual(expect.arrayContaining(["bash", "task_stop"]));

		const excluded = await create({ excludedToolNames: ["task_stop"] });
		expect(excluded.session.getActiveToolNames()).toContain("bash");
		expect(excluded.session.getActiveToolNames()).not.toContain("task_stop");

		const noShell = await create({ initialActiveToolNames: ["read"] });
		expect(noShell.session.getActiveToolNames()).not.toContain("task_stop");
	});

	it("keeps background commands for an extension's copy of bash, unless it replaced execute", async () => {
		const restyled = await create({
			extensionFactories: [
				(knightcode) =>
					knightcode.registerTool({ ...createBashToolDefinition(process.cwd()), label: "bash (restyled)" }),
			],
		});
		await restyled.session.bindExtensions({});
		expect(offersBackgroundShells(restyled.session.getToolDefinition("bash"))).toBe(true);
		expect(restyled.session.getActiveToolNames()).toContain("task_stop");
		restyled.setResponses([
			startBackground("echo from the copy"),
			fauxAssistantMessage("ok"),
			fauxAssistantMessage("seen"),
		]);
		await restyled.session.prompt("go");
		await restyled.session.waitForBackgroundShells();
		expect(getMessageText(backgroundMessages(restyled)[0])).toContain("from the copy");

		const original = createBashToolDefinition(process.cwd());
		const wrapped = await create({
			extensionFactories: [
				(knightcode) =>
					knightcode.registerTool({
						...original,
						execute: (id, params, signal, onUpdate, ctx) => original.execute(id, params, signal, onUpdate, ctx),
					}),
			],
		});
		await wrapped.session.bindExtensions({});
		expect(offersBackgroundShells(wrapped.session.getToolDefinition("bash"))).toBe(false);
		expect(wrapped.session.getActiveToolNames()).not.toContain("task_stop");
	});

	it("starts a run to report a command that ends while the agent is idle", async () => {
		const harness = await create();
		const gate = join(harness.tempDir, "gate");
		harness.setResponses([
			startBackground(waitForFile(gate, "echo built")),
			fauxAssistantMessage("building in the background"),
			fauxAssistantMessage("the build finished"),
		]);

		await harness.session.prompt("build it");
		expect(harness.session.backgroundShells.runningCount()).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(1);

		writeFileSync(gate, "");
		await harness.session.waitForBackgroundShells();

		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.eventsOfType("agent_start")).toHaveLength(2);
		const [notice] = backgroundMessages(harness);
		const text = getMessageText(notice);
		expect(text).toContain("<status>completed</status>");
		expect(text).toContain("built");
		expect(getAssistantTexts(harness).at(-1)).toBe("the build finished");
		// The notice is in the transcript, so a resumed session shows it too.
		expect(
			harness.sessionManager
				.getEntries()
				.some((entry) => entry.type === "custom_message" && entry.customType === BACKGROUND_SHELL_MESSAGE_TYPE),
		).toBe(true);
	});

	it("reports a command that ends during a run before the next response, in the same run", async () => {
		const harness = await create();
		harness.setResponses([
			startBackground("echo quick"),
			fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");
		await harness.session.waitForBackgroundShells();

		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.eventsOfType("agent_start")).toHaveLength(1);
		const roles = harness.session.messages.map((message) =>
			message.role === "custom" ? (message as CustomMessage).customType : message.role,
		);
		const noticeIndex = roles.indexOf(BACKGROUND_SHELL_MESSAGE_TYPE);
		expect(noticeIndex).toBeGreaterThan(-1);
		expect(roles.lastIndexOf("assistant")).toBeGreaterThan(noticeIndex);
		expect(getMessageText(backgroundMessages(harness)[0])).toContain("quick");
	});

	it("records an end without starting a run after the user aborted, until the next prompt", async () => {
		const harness = await create();
		harness.setResponses([startBackground("sleep 1; echo late"), fauxAssistantMessage("x".repeat(20_000))]);
		const sawSecondResponse = new Promise<void>((resolve) => {
			let assistantStarts = 0;
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "message_start" && event.message.role === "assistant" && ++assistantStarts === 2) {
					unsubscribe();
					resolve();
				}
			});
		});

		const prompt = harness.session.prompt("go");
		await sawSecondResponse;
		await harness.session.abort();
		await prompt;
		await harness.session.waitForBackgroundShells();

		expect(harness.eventsOfType("agent_start")).toHaveLength(1);
		expect(getMessageText(backgroundMessages(harness)[0])).toContain("late");

		// Speaking again re-arms waking: the next end starts a run.
		harness.setResponses([startBackground("echo again"), fauxAssistantMessage("ok"), fauxAssistantMessage("noted")]);
		await harness.session.prompt("once more");
		await harness.session.waitForBackgroundShells();
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(getAssistantTexts(harness).at(-1)).toBe("noted");
	});

	it("does not report a command the model stopped itself", async () => {
		const harness = await create();
		harness.setResponses([
			startBackground("sleep 30"),
			() =>
				fauxAssistantMessage(
					[fauxToolCall("task_stop", { task_id: harness.session.backgroundShells.list()[0]?.id ?? "" })],
					{ stopReason: "toolUse" },
				),
			fauxAssistantMessage("stopped it"),
		]);

		await harness.session.prompt("start and stop");
		await harness.session.waitForBackgroundShells();

		const [shell] = harness.session.backgroundShells.list();
		expect(shell).toMatchObject({ status: "stopped", stoppedBy: "model" });
		expect(backgroundMessages(harness)).toHaveLength(0);
		expect(harness.eventsOfType("agent_start")).toHaveLength(1);
	});

	it("reports a command the user stopped without starting a run", async () => {
		const harness = await create();
		harness.setResponses([startBackground("sleep 30"), fauxAssistantMessage("running")]);
		await harness.session.prompt("start");

		const [shell] = harness.session.backgroundShells.list();
		harness.session.backgroundShells.stop(shell?.id as string, "user");
		await harness.session.waitForBackgroundShells();

		expect(harness.eventsOfType("agent_start")).toHaveLength(1);
		expect(getMessageText(backgroundMessages(harness)[0])).toContain("was stopped by the user");
	});

	it("stops its background commands when disposed, and records that the session ended them", async () => {
		const harness = await create();
		harness.setResponses([startBackground("sleep 30"), fauxAssistantMessage("running")]);
		await harness.session.prompt("start");
		const manager = harness.session.backgroundShells;
		const [shell] = manager.list();

		harness.session.dispose();
		expect(await manager.waitForExit(shell?.id as string, 10_000)).toBe(true);
		expect(manager.get(shell?.id as string)).toMatchObject({ status: "stopped", stoppedBy: "session" });
		// Recorded once, at dispose: the process exiting afterwards adds nothing.
		const recorded = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom_message" && entry.customType === BACKGROUND_SHELL_MESSAGE_TYPE);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			details: { notices: [{ id: shell?.id, status: "stopped", stoppedBy: "session" }] },
		});
		expect(JSON.stringify(recorded[0])).toContain("was stopped because the session ended");
		expect(harness.eventsOfType("agent_start")).toHaveLength(1);
	});

	it("records at dispose a command the model asked to stop that has not exited", async () => {
		const harness = await create();
		harness.setResponses([startBackground("sleep 30"), fauxAssistantMessage("running")]);
		await harness.session.prompt("start");
		const manager = harness.session.backgroundShells;
		const [shell] = manager.list();

		// As task_stop leaves it when its wait gives up: asked to stop, still running.
		manager.stop(shell?.id as string, "model");
		harness.session.dispose();
		expect(await manager.waitForExit(shell?.id as string, 10_000)).toBe(true);
		const recorded = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom_message" && entry.customType === BACKGROUND_SHELL_MESSAGE_TYPE);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			details: { notices: [{ id: shell?.id, status: "stopped", stoppedBy: "model" }] },
		});
	});

	it("does not let a notice start a run while a prompt is in preflight", async () => {
		const harness = await create({
			extensionFactories: [
				(knightcode) => {
					knightcode.on("input", async (event) => {
						if (event.text === "second") await sleep(800);
						return { action: "continue" };
					});
				},
			],
		});
		await harness.session.bindExtensions({});
		harness.setResponses([
			startBackground("sleep 0.3; echo done"),
			fauxAssistantMessage("started"),
			fauxAssistantMessage("answer to second"),
		]);
		await harness.session.prompt("go");

		// The command ends while the input handler holds the second prompt's preflight.
		await harness.session.prompt("second");
		await harness.session.waitForBackgroundShells();

		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.eventsOfType("agent_start")).toHaveLength(2);
		expect(getAssistantTexts(harness).at(-1)).toBe("answer to second");
		// The notice joined the prompt's run instead of starting its own.
		expect(getMessageText(backgroundMessages(harness)[0])).toContain("done");
	});

	it("reports a command that ended during tree navigation once the session is idle again", async () => {
		const harness = await create({
			extensionFactories: [
				(knightcode) => {
					knightcode.on("session_before_tree", async () => {
						await sleep(800);
						return undefined;
					});
				},
			],
		});
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage("first answer"),
			startBackground("sleep 0.3; echo done"),
			fauxAssistantMessage("started"),
			fauxAssistantMessage("noticed"),
		]);
		await harness.session.prompt("one");
		const target = harness.sessionManager.getLeafId() as string;
		await harness.session.prompt("two");

		await harness.session.navigateTree(target, { summarize: false });
		await harness.session.waitForBackgroundShells();

		expect(harness.eventsOfType("agent_start")).toHaveLength(3);
		expect(getAssistantTexts(harness).at(-1)).toBe("noticed");
	});

	it("survives a session that can no longer be written when a notice arrives", async () => {
		const harness = await create();
		harness.setResponses([startBackground("sleep 30"), fauxAssistantMessage("running")]);
		await harness.session.prompt("start");
		harness.sessionManager.appendCustomMessageEntry = () => {
			throw new Error("simulated lost session lock");
		};

		const [shell] = harness.session.backgroundShells.list();
		harness.session.backgroundShells.stop(shell?.id as string, "user");
		await harness.session.waitForBackgroundShells();
		// Deferred delivery runs from a timer, where a throw would surface as an uncaught exception.
		await sleep(50);

		expect(harness.session.backgroundShells.get(shell?.id as string)?.status).toBe("stopped");
		expect(backgroundMessages(harness)).toHaveLength(0);
	});

	/** A session file as an earlier process left it, with the given messages after the user's first prompt. */
	function previousSession(...messages: unknown[]): SessionManager {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "start the dev server", timestamp: Date.now() });
		for (const message of messages) sessionManager.appendMessage(message as never);
		return sessionManager;
	}

	const usage = {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};

	function toolCalls(...calls: Array<{ id: string; name: string; arguments: unknown }>) {
		const content = calls.map((call) => ({ type: "toolCall", ...call }));
		return {
			role: "assistant",
			content,
			api: "faux",
			provider: "faux",
			model: "faux-1",
			usage,
			stopReason: "toolUse",
			timestamp: Date.now(),
		};
	}

	function toolResult(toolCallId: string, toolName: string, details: unknown) {
		return {
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text: "ok" }],
			details,
			isError: false,
			timestamp: Date.now(),
		};
	}

	it("tells the model with the next run that a resumed session's background commands are not running", async () => {
		const sessionManager = previousSession(
			toolCalls({ id: "call-1", name: "bash", arguments: { command: "npm run dev" } }),
			toolResult("call-1", "bash", {
				background: { taskId: "0badc0de", movedByUser: false },
				fullOutputPath: "/tmp/dev.log",
			}),
		);
		const harness = await create({ sessionManager });
		harness.setResponses([fauxAssistantMessage("I will start it again")]);

		// Opening the session records nothing.
		expect(backgroundMessages(harness)).toHaveLength(0);
		await harness.session.prompt("is the server up?");

		const text = getMessageText(backgroundMessages(harness)[0]);
		expect(text).toContain("<task-id>0badc0de</task-id>");
		expect(text).toContain('"npm run dev" was started by an earlier session and is not running in this one');
		expect(harness.eventsOfType("agent_start")).toHaveLength(1);
	});

	it("opens a session with malformed entries and reports only shell launches", async () => {
		const sessionManager = previousSession(
			toolCalls(
				{ id: "call-1", name: "bash", arguments: { command: "npm run dev" } },
				{ id: "call-2", name: "custom_tool", arguments: undefined },
				{ id: "call-3", name: "subagent", arguments: { task: "research" } },
			),
			toolResult("call-1", "bash", { background: { taskId: "0badc0de", movedByUser: false } }),
			toolResult("call-2", "custom_tool", undefined),
			// Another tool's own notion of running in the background is not a shell command.
			toolResult("call-3", "subagent", { background: true }),
		);
		sessionManager.appendCustomMessageEntry(BACKGROUND_SHELL_MESSAGE_TYPE, "", false, { notices: "not a list" });
		const harness = await create({ sessionManager });
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("continue");

		const text = backgroundMessages(harness)
			.map((message) => getMessageText(message))
			.join("\n");
		expect(text).toContain("<task-id>0badc0de</task-id>");
		expect(text).not.toContain("undefined");
		expect(text.match(/<task-notification>/g)).toHaveLength(1);
	});

	it("records a notice still waiting when the session is disposed", async () => {
		const harness = await create();
		harness.setResponses([startBackground("sleep 0.2; echo late"), fauxAssistantMessage("running")]);
		await harness.session.prompt("start");
		// Teardown holds wake while shutdown handlers run; the command ends during that window.
		harness.session.holdBackgroundWake();
		const [shell] = harness.session.backgroundShells.list();
		await harness.session.backgroundShells.waitForExit(shell?.id as string, 10_000);

		harness.session.dispose();

		const recorded = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom_message" && entry.customType === BACKGROUND_SHELL_MESSAGE_TYPE);
		expect(recorded).toHaveLength(1);
		expect(JSON.stringify(recorded[0])).toContain("completed (exit code 0)");
	});
});
