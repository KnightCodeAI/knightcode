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

// A restart pins the port the previous process reported, so the adapter
// processes the IDE's panel already holds find the new engine where they
// left the old one. Absent or 0 is an ephemeral port, as before.
const pinned = process.env.KNIGHTCODE_ENGINE_PORT;
const port = pinned === undefined || pinned === "" ? 0 : Number(pinned);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
	console.error("KNIGHTCODE_ENGINE_PORT must be an integer between 1 and 65535");
	process.exit(2);
}

bypassProxyForLoopback();

// No credential path is passed, so this is the CLI's own auth.json and its
// cross-process lock. One login serves both front doors.
const ctx = await createEngineContext({ allowModelNetwork: true });
const sessions = createSessionRegistry(ctx);

const server = await startEngineServer({ token, port, routes: engineRoutes(ctx, sessions) });

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
// The IDE holds the other end of stdin. When that end closes — a quit, a
// crash, a deliberate stop — the engine must not outlive it, on any platform:
// a GUI process on Windows can send no signal, and gpui gives quit handlers
// 200 ms. This is what the ACP adapter already does with its own stdin.
process.stdin.once("end", shutdown);
process.stdin.once("error", shutdown);
process.stdin.resume();
