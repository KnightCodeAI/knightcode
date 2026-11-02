// Starts the emulated services once per test run (in Node, from the Vitest config) and stops them from the global
// teardown. The two load this file separately, so the running set lives on a global symbol.
import { createEmulator, type Emulator, type ServiceName } from "emulate";
import config, { TEST_OAUTH } from "../emulate.config.ts";
import { COMPOSIO_TEST_KEY, startComposio } from "./emulators/composio.ts";
import { startMcpServer } from "./emulators/mcp-server.ts";
import { startTelegram, TELEGRAM_TEST_SECRET, TELEGRAM_TEST_TOKEN } from "./emulators/telegram.ts";

const RUNNING = Symbol.for("knightcode-bots.emulators");
type Closer = { url: string; close(): Promise<void> };
type Running = Promise<Partial<Record<ServiceName, Emulator>> & { mcp?: Closer; composio?: Closer; telegram?: Closer }>;
const registry = globalThis as { [RUNNING]?: Running };

async function start(): Running {
	const out: Awaited<Running> = {};
	for (const [name, service] of Object.entries(config.services)) {
		const id = name as ServiceName;
		out[id] = await createEmulator({ service: id, port: 0, seed: { [id]: service.seed } });
	}
	// Our own stand-ins: a remote MCP server and Composio's API.
	out.mcp = await startMcpServer();
	out.composio = await startComposio();
	out.telegram = await startTelegram();
	return out;
}

/** The miniflare bindings that point the Worker at the emulators, plus the test OAuth clients. */
export async function emulatorBindings(): Promise<Record<string, string>> {
	registry[RUNNING] ??= start();
	const running = await registry[RUNNING];
	return {
		EMULATE_GITHUB_URL: running.github!.url,
		EMULATE_GOOGLE_URL: running.google!.url,
		GITHUB_CLIENT_ID: TEST_OAUTH.github.clientId,
		GITHUB_CLIENT_SECRET: TEST_OAUTH.github.clientSecret,
		GOOGLE_CLIENT_ID: TEST_OAUTH.google.clientId,
		GOOGLE_CLIENT_SECRET: TEST_OAUTH.google.clientSecret,
		EMULATE_MCP_URL: running.mcp!.url,
		COMPOSIO_BASE_URL: running.composio!.url,
		COMPOSIO_API_KEY: COMPOSIO_TEST_KEY,
		TELEGRAM_API_URL: running.telegram!.url,
		TELEGRAM_BOT_TOKEN: TELEGRAM_TEST_TOKEN,
		TELEGRAM_WEBHOOK_SECRET: TELEGRAM_TEST_SECRET,
	};
}

/** Closes every emulator this run started. */
export async function stopEmulators(): Promise<void> {
	const running = registry[RUNNING];
	if (!running) return;
	delete registry[RUNNING];
	await Promise.all(Object.values(await running).map((emulator) => emulator?.close()));
}
