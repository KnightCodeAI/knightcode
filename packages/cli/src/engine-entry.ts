#!/usr/bin/env bun
/**
 * knightcode-engine — the headless engine the IDE drives.
 *
 * Prints one JSON line on stdout once it is listening; the IDE reads the port
 * from it, then polls /health before sending anything else.
 */

// Static, and first: this registers the OAuth flows and the Bedrock provider
// module into the compiled binary. Without it those load through dynamic
// imports that a Bun single-file build never embeds, so every advertised login
// flow fails at runtime in the shipped binary while working fine from source.
import "./bun/runtime-setup.ts";
import { runAcp } from "./engine/acp/run.ts";
import { createEngineContext } from "./engine/context.ts";
import { bypassProxyForLoopback } from "./engine/proxy.ts";
import { engineRoutes } from "./engine/routes.ts";
import { startEngineServer } from "./engine/server.ts";
import { createSessionRegistry } from "./engine/sessions.ts";

process.title = "knightcode-engine";
process.env.KNIGHTCODE_CODING_AGENT = "true";
process.env.AI_AGENT = "knightcode";

// `knightcode-engine acp` is the adapter, not the server: it makes its own
// token when it boots an engine, so the check below does not apply.
if (process.argv[2] === "acp") {
	await runAcp(process.argv.slice(3));
	process.exit(0);
}

const MINIMUM_TOKEN_LENGTH = 32;

const token = process.env.KNIGHTCODE_ENGINE_TOKEN;
if (!token || token.length < MINIMUM_TOKEN_LENGTH) {
	console.error(`KNIGHTCODE_ENGINE_TOKEN must be set to at least ${MINIMUM_TOKEN_LENGTH} characters`);
	process.exit(2);
}

bypassProxyForLoopback();

// No credential path is passed, so this is the CLI's own auth.json and its
// cross-process lock. One login serves both front doors.
const ctx = await createEngineContext({ allowModelNetwork: true });
const sessions = createSessionRegistry(ctx);

const server = await startEngineServer({ token, routes: engineRoutes(ctx, sessions) });

process.stdout.write(`${JSON.stringify({ type: "listening", port: server.port })}\n`);

let closing = false;
const shutdown = () => {
	if (closing) return;
	closing = true;
	void sessions
		.closeAll()
		.then(() => server.close())
		.finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
