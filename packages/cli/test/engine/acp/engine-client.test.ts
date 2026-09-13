import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxProvider } from "@knightcode/ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineClient, EngineRequestError } from "../../../src/engine/acp/engine-client.ts";
import { createEngineContext } from "../../../src/engine/context.ts";
import { createEventBus, type EngineEvent, eventsRoute } from "../../../src/engine/events.ts";
import { modelsRoute } from "../../../src/engine/models.ts";
import { type EngineRoute, type EngineServer, startEngineServer } from "../../../src/engine/server.ts";
import { sessionRoutes } from "../../../src/engine/session-routes.ts";
import { createSessionRegistry, type SessionRegistry } from "../../../src/engine/sessions.ts";

async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("engine client", () => {
	let counter = 0;
	let server: EngineServer | undefined;
	let registry: SessionRegistry | undefined;
	const dirs: string[] = [];

	afterEach(async () => {
		await registry?.closeAll();
		await server?.close();
		registry = undefined;
		server = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(extraRoutes: readonly EngineRoute[] = []) {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-engine-client-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-engine-client-agent-"));
		dirs.push(cwd, agentDir);
		const events = createEventBus();
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null, events });
		const faux = fauxProvider({ provider: `faux-engine-client-${counter++}` });
		ctx.models.registerNativeProvider(faux.provider);
		registry = createSessionRegistry(ctx, { agentDir, sessionDir: null, defaultModel: faux.getModel() });
		server = await startEngineServer({
			token: "t",
			routes: [...extraRoutes, eventsRoute(events, 50), modelsRoute(ctx), ...sessionRoutes(ctx, registry)],
		});
		const client = createEngineClient({ baseUrl: `http://127.0.0.1:${server.port}`, token: "t", reconnectDelayMs: 10 });
		return { client, cwd, faux, events };
	}

	test("round-trips a session and lists models", async () => {
		const { client, cwd, faux } = await start();
		const created = await client.createSession({ cwd, capabilities: { readTextFile: true, writeTextFile: true } });
		expect(created.model?.ref).toBe(`${faux.provider.id}/${faux.getModel().id}`);
		expect(await client.getSession(created.id)).toEqual(created);
		const level = created.thinkingLevels.find((candidate) => candidate !== created.thinkingLevel) ?? "off";
		expect((await client.updateSession(created.id, { thinkingLevel: level })).thinkingLevel).toBe(level);
		expect((await client.models()).some((model) => model.ref === created.model?.ref)).toBe(true);
		await client.closeSession(created.id);
		await expect(client.getSession(created.id)).rejects.toMatchObject({ status: 404, code: "not_found" });
	});

	test("an engine error carries its status and code", async () => {
		const { client } = await start();
		const error = await client.createSession({ cwd: "" }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(EngineRequestError);
		expect(error).toMatchObject({ status: 400, code: "bad_request" });
	});

	test("delivers events in order and reconnects after a drop", async () => {
		// A stream that ends after its first event, so the client must come back for the second.
		let connections = 0;
		const bus = createEventBus();
		const flaky: EngineRoute = {
			method: "GET",
			path: "/events",
			handle: (_req, res) => {
				connections += 1;
				res.writeHead(200, { "content-type": "text/event-stream" });
				const unsubscribe = bus.subscribe((event) => {
					res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
					if (connections === 1) res.end();
				});
				res.on("close", unsubscribe);
			},
		};
		const { client } = await start([flaky]);
		const seen: EngineEvent[] = [];
		let drops = 0;
		const controller = new AbortController();
		const loop = client.events(
			{
				onEvent: async (event) => {
					seen.push(event);
				},
				onDisconnect: () => {
					drops += 1;
				},
			},
			controller.signal,
		);

		await waitFor(() => connections === 1);
		bus.publish({ type: "models.changed" });
		await waitFor(() => drops === 1 && connections === 2);
		bus.publish({ type: "account.changed", providerId: "p", authenticated: true });
		await waitFor(() => seen.length === 2);
		expect(seen.map((event) => event.type)).toEqual(["models.changed", "account.changed"]);

		controller.abort();
		await loop;
	});
});
