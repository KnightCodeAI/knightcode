// Starts the emulated services once per test run (in Node, from the Vitest config) and stops them from the global
// teardown. The two load this file separately, so the running set lives on a global symbol.
import { createEmulator, type Emulator, type ServiceName } from "emulate";
import config, { TEST_OAUTH } from "../emulate.config.ts";

const RUNNING = Symbol.for("knightcode-bots.emulators");
type Running = Promise<Partial<Record<ServiceName, Emulator>>>;
const registry = globalThis as { [RUNNING]?: Running };

async function start(): Running {
	const out: Partial<Record<ServiceName, Emulator>> = {};
	for (const [name, service] of Object.entries(config.services)) {
		const id = name as ServiceName;
		out[id] = await createEmulator({ service: id, port: 0, seed: { [id]: service.seed } });
	}
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
	};
}

/** Closes every emulator this run started. */
export async function stopEmulators(): Promise<void> {
	const running = registry[RUNNING];
	if (!running) return;
	delete registry[RUNNING];
	await Promise.all(Object.values(await running).map((emulator) => emulator?.close()));
}
