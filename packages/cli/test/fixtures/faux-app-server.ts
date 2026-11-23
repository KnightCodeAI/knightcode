/**
 * An app server whose model is the faux provider, for the desktop app's end-to-end tests
 * (apps/desktop/test/e2e): `KNIGHTCODE_DESKTOP_SERVER="bun <this file>"`. The provider is registered natively, as
 * runAppServer's setup would register a real one, so the desktop has a model before any thread loads. No credentials,
 * no network. The reply depends on the prompt:
 *
 * - "run echo <word>": a bash call of `echo <word>`, then "Ran it."
 * - "run background <word>": a background bash call of `echo <word>`, then "Started it."
 * - "count slowly": a long reply streamed slowly, to interrupt or to quit over
 * - "wait for stop": a turn that streams nothing until it is stopped
 * - "think first": a long reasoning block headed "Checking the fixture", streamed for seconds, then "Thought it through."
 * - "ask a question": an ask_user call with one two-option question, then "Got your answer."
 * - "show the counter": the examples/mcp-app counter's app tool, then "Here is the counter."
 * - anything else: "Hello from the faux model."
 *
 * KNIGHTCODE_FAUX_PID_FILE receives this process's pid. While the file named by KNIGHTCODE_FAUX_HOLD_FILE exists,
 * startup waits before answering the handshake, so a test can hold the desktop in its reconnecting state.
 */

import "../../src/bun/runtime-setup.ts";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxThinking,
	fauxToolCall,
	InMemoryCredentialStore,
	type Message,
} from "@knightcode/ai";
import { createAppServerContext } from "../../src/app-server/context.ts";
import { appServerHandlers } from "../../src/app-server/entry.ts";
import { AppServer } from "../../src/app-server/server.ts";
import { createStdioTransport } from "../../src/app-server/stdio.ts";
import { ThreadManager } from "../../src/app-server/threads.ts";
import { getAgentDir, VERSION } from "../../src/config.ts";
import { takeOverStdout, writeRawStdoutReporting } from "../../src/core/output-guard.ts";

takeOverStdout();
process.stdout.on("error", () => {});

const faux = fauxProvider({ provider: "faux-e2e", models: [{ id: "faux-e2e", name: "Faux E2E" }], tokensPerSecond: 200 });

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.map((part: { type?: string; text?: string }) => (part.type === "text" ? (part.text ?? "") : "")).join("")
			: "";

const AFTER_TOOL: [prefix: string, text: string][] = [
	["show the counter", "Here is the counter."],
	["ask a question", "Got your answer."],
	["run background", "Started it."],
];

function reply(messages: Message[], signal: AbortSignal | undefined): AssistantMessage | Promise<AssistantMessage> {
	const last = messages.at(-1);
	const user = [...messages].reverse().find((m) => m.role === "user");
	const prompt = textOf(user?.content).trim();
	if (last?.role === "toolResult")
		return fauxAssistantMessage([fauxText(AFTER_TOOL.find(([prefix]) => prompt.startsWith(prefix))?.[1] ?? "Ran it.")]);
	const echo = /^run echo (\S+)/.exec(prompt);
	if (echo) return fauxAssistantMessage([fauxToolCall("bash", { command: `echo ${echo[1]}` })], { stopReason: "toolUse" });
	const background = /^run background (\S+)/.exec(prompt);
	if (background)
		return fauxAssistantMessage([fauxToolCall("bash", { command: `echo ${background[1]}`, run_in_background: true })], {
			stopReason: "toolUse",
		});
	if (prompt.startsWith("count slowly"))
		return fauxAssistantMessage([fauxText(Array.from({ length: 2000 }, (_, i) => `${i + 1}`).join(" "))]);
	if (prompt.startsWith("wait for stop"))
		return new Promise((resolve) => {
			const done = () => resolve(fauxAssistantMessage([fauxText("Stopped.")]));
			if (!signal || signal.aborted) done();
			else signal.addEventListener("abort", done, { once: true });
		});
	if (prompt.startsWith("think first"))
		return fauxAssistantMessage([
			fauxThinking(`**Checking the fixture**\n\n${"Reading the fixture slowly. ".repeat(200)}`),
			fauxText("Thought it through."),
		]);
	if (prompt.startsWith("ask a question"))
		return fauxAssistantMessage(
			[
				fauxToolCall("ask_user", {
					questions: [
						{
							id: "layout",
							question: "Which layout should the fixture use?",
							options: [
								{ label: "Compact", description: "Fits more rows on the screen." },
								{ label: "Comfortable", description: "Leaves more space around each row." },
							],
						},
					],
				}),
			],
			{ stopReason: "toolUse" },
		);
	if (prompt.startsWith("show the counter"))
		return fauxAssistantMessage([fauxToolCall("mcp__counter__show_counter", {})], { stopReason: "toolUse" });
	return fauxAssistantMessage([fauxText("Hello from the faux model.")]);
}

faux.setResponses(
	Array.from(
		{ length: 500 },
		() => (context: { messages: Message[] }, options?: { signal?: AbortSignal }) =>
			reply(context.messages, options?.signal),
	),
);

if (process.env.KNIGHTCODE_FAUX_PID_FILE) writeFileSync(process.env.KNIGHTCODE_FAUX_PID_FILE, String(process.pid));
const hold = process.env.KNIGHTCODE_FAUX_HOLD_FILE;
while (hold && existsSync(hold)) await new Promise((resolve) => setTimeout(resolve, 100));

const ctx = await createAppServerContext({
	agentDir: getAgentDir(),
	credentials: new InMemoryCredentialStore(),
	modelsPath: null,
	defaultModel: faux.getModel(),
});
ctx.models.registerNativeProvider(faux.provider);
await ctx.models.refresh({ allowNetwork: false });
// Keep S0 screenshot usage deterministic: the faux model derives token counts from the prompt.
// Desktop skill discovery is verified separately against the real packaged server in extension-authoring.e2e.ts.
const threads = new ThreadManager(ctx, {
	disabledBuiltinExtensions: ["desktop-customization"],
	// Exercise the missing-gh path without hiding Git or running the developer's gh.
	ghCommand: [join(ctx.agentDir, "missing-gh", "gh")],
});
const transport = createStdioTransport(process.stdin, writeRawStdoutReporting);
const exit = async () => {
	setTimeout(() => process.exit(0), 5_000);
	await threads.closeAll();
	process.exit(0);
};
new AppServer({
	transport,
	mode: "desktop",
	version: VERSION,
	handlers: appServerHandlers(ctx, threads),
	onInitialized: (connection) => ctx.connections.add(connection),
	onInputEnd: (connection) => {
		threads.disconnect(connection);
		void exit();
	},
	onClose: (connection) => {
		ctx.connections.delete(connection);
		threads.disconnect(connection);
		void exit();
	},
});
