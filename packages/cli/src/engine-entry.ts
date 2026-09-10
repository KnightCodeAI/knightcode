#!/usr/bin/env bun
/**
 * knightcode-engine — the headless engine the IDE drives.
 *
 * Prints one JSON line on stdout once it is listening; the IDE reads the port
 * from it, then polls /health before sending anything else.
 */

import { join } from "node:path";
import { createBunSecretBackend } from "./bun/secrets.ts";
import { getAgentDir } from "./config.ts";
import { accountsRoutes } from "./engine/accounts.ts";
import { completionsRoutes } from "./engine/completions.ts";
import { createEngineContext } from "./engine/context.ts";
import { eventsRoute } from "./engine/events.ts";
import { modelsRoute } from "./engine/models.ts";
import type { SecretBackend } from "./engine/secrets.ts";
import { startEngineServer } from "./engine/server.ts";

process.title = "knightcode-engine";
process.env.KNIGHTCODE_CODING_AGENT = "true";
process.env.AI_AGENT = "knightcode";

const MINIMUM_TOKEN_LENGTH = 32;

const token = process.env.KNIGHTCODE_ENGINE_TOKEN;
if (!token || token.length < MINIMUM_TOKEN_LENGTH) {
	console.error(`KNIGHTCODE_ENGINE_TOKEN must be set to at least ${MINIMUM_TOKEN_LENGTH} characters`);
	process.exit(2);
}

// Loopback must never go through a proxy: a corporate HTTP_PROXY otherwise
// swallows the IDE's own traffic to this server.
for (const key of ["NO_PROXY", "no_proxy"]) {
	const entries = (process.env[key] ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	for (const host of ["127.0.0.1", "localhost", "::1"]) {
		if (!entries.some((value) => value.toLowerCase() === host)) entries.push(host);
	}
	process.env[key] = entries.join(",");
}

let backend: SecretBackend | undefined;
let keychainError: string | undefined;
try {
	const candidate = createBunSecretBackend();
	// Probe rather than trust: a machine with no Secret Service constructs fine
	// and fails on first use.
	await candidate.get("startup-probe");
	backend = candidate;
} catch (error) {
	keychainError = error instanceof Error ? error.message : String(error);
	console.error(`keychain unavailable, falling back to the file store: ${keychainError}`);
}

const ctx = await createEngineContext({
	backend,
	indexPath: join(getAgentDir(), "engine-accounts.json"),
	fallbackAuthPath: join(getAgentDir(), "auth.json"),
	allowModelNetwork: true,
});

const server = await startEngineServer({
	token,
	routes: [eventsRoute(ctx.events), modelsRoute(ctx), ...accountsRoutes(ctx), ...completionsRoutes(ctx)],
});

process.stdout.write(`${JSON.stringify({ type: "listening", port: server.port, keychain: ctx.keychainAvailable })}\n`);

let closing = false;
const shutdown = () => {
	if (closing) return;
	closing = true;
	void server.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
