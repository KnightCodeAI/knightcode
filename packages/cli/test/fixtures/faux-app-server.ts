/**
 * An app server whose model is the faux provider, for the desktop app's end-to-end tests
 * (apps/desktop/test/e2e): `KNIGHTCODE_DESKTOP_SERVER="bun <this file>"`. The provider is registered natively, as
 * runAppServer's setup would register a real one, so the desktop has a model before any thread loads. No credentials,
 * no network. The reply depends on the prompt:
 *
 * - "run echo <word>": a bash call of `echo <word>`, then "Ran it."
 * - "count slowly": a long reply streamed slowly, to interrupt or to quit over
 * - "show the counter": the examples/mcp-app counter's app tool, then "Here is the counter."
 * - anything else: "Hello from the faux model."
 */

import "../../src/bun/runtime-setup.ts";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
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

function reply(messages: Message[]): AssistantMessage {
	const last = messages.at(-1);
	const user = [...messages].reverse().find((m) => m.role === "user");
	const prompt = textOf(user?.content).trim();
	if (last?.role === "toolResult")
		return fauxAssistantMessage([fauxText(prompt.startsWith("show the counter") ? "Here is the counter." : "Ran it.")]);
	const echo = /^run echo (\S+)/.exec(prompt);
	if (echo) return fauxAssistantMessage([fauxToolCall("bash", { command: `echo ${echo[1]}` })], { stopReason: "toolUse" });
	if (prompt.startsWith("count slowly"))
		return fauxAssistantMessage([fauxText(Array.from({ length: 2000 }, (_, i) => `${i + 1}`).join(" "))]);
	if (prompt.startsWith("show the counter"))
		return fauxAssistantMessage([fauxToolCall("mcp__counter__show_counter", {})], { stopReason: "toolUse" });
	return fauxAssistantMessage([fauxText("Hello from the faux model.")]);
}

faux.setResponses(Array.from({ length: 500 }, () => (context: { messages: Message[] }) => reply(context.messages)));

const ctx = await createAppServerContext({
	agentDir: getAgentDir(),
	credentials: new InMemoryCredentialStore(),
	modelsPath: null,
	defaultModel: faux.getModel(),
});
ctx.models.registerNativeProvider(faux.provider);
await ctx.models.refresh({ allowNetwork: false });
const threads = new ThreadManager(ctx, {});
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
