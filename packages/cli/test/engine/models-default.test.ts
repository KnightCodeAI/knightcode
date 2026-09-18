import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxProvider, type Provider } from "@knightcode/ai";
import { afterEach, describe, expect, test } from "vitest";
import { InMemorySettingsStorage, SettingsManager, type Settings } from "../../src/core/settings-manager.ts";
import { createEngineContext, type EngineContext } from "../../src/engine/context.ts";
import { eventsRoute } from "../../src/engine/events.ts";
import { modelsRoute, setDefaultModelRoute, telemetrySettingsRoutes } from "../../src/engine/models.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

const auth = { authorization: "Bearer t" };

interface ModelsBody {
	models: { ref: string; id: string; providerId: string }[];
	default: string | null;
}

/** Same gate as models.test.ts: a provider that only appears once a key is stored. */
function gatedFauxProvider(id: string): Provider {
	const handle = fauxProvider({ provider: id });
	return {
		...handle.provider,
		auth: {
			apiKey: {
				name: "Gated faux",
				resolve: async ({ credential }) => (credential?.key ? { auth: { apiKey: credential.key } } : undefined),
			},
		},
	};
}

describe("PUT /v1/models/default", () => {
	let server: EngineServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	async function start(
		settings?: Partial<Settings>,
		manager?: SettingsManager,
	): Promise<{ base: string; ctx: EngineContext }> {
		const ctx = await createEngineContext({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			settings: manager ?? (settings === undefined ? undefined : SettingsManager.inMemory(settings)),
		});
		server = await startEngineServer({
			token: "t",
			routes: [eventsRoute(ctx.events), modelsRoute(ctx), setDefaultModelRoute(ctx), ...telemetrySettingsRoutes(ctx)],
		});
		return { base: `http://127.0.0.1:${server.port}`, ctx };
	}

	async function withOneModel(manager?: SettingsManager) {
		const started = await start({}, manager);
		started.ctx.models.registerNativeProvider(gatedFauxProvider("faux-pick"));
		await started.ctx.credentials.modify("faux-pick", async () => ({ type: "api_key", key: "stored-key" }));
		const body = (await (await fetch(`${started.base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		const model = body.models.find((entry) => entry.providerId === "faux-pick");
		expect(model).toBeDefined();
		return { ...started, ref: model!.ref };
	}

	const put = (base: string, body: unknown, path = "/v1/models/default") =>
		fetch(`${base}${path}`, {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	test("a ref from the catalog becomes the default the next GET reports", async () => {
		const { base, ref } = await withOneModel();
		const response = await put(base, { ref });
		expect(response.status).toBe(200);

		const after = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(after.default).toBe(ref);
	});

	test("an unknown ref is a 400 and changes nothing", async () => {
		const { base, ref } = await withOneModel();
		await put(base, { ref });

		const response = await put(base, { ref: "faux-pick/not-a-model" });
		expect(response.status).toBe(400);

		const after = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(after.default).toBe(ref);
	});

	test("a ref with no provider separator is a 400", async () => {
		const { base } = await withOneModel();
		expect((await put(base, { ref: "bare-model-id" })).status).toBe(400);
		expect((await put(base, {})).status).toBe(400);
	});

	test("a body that is not JSON is a 400, and an oversized one a 413", async () => {
		const { base } = await withOneModel();
		const raw = (body: string) =>
			fetch(`${base}/v1/models/default`, { method: "PUT", headers: auth, body }).then((res) => res.status);
		expect(await raw("{not json")).toBe(400);
		expect(await raw(JSON.stringify({ ref: "x".repeat(64 * 1024) }))).toBe(413);
	});

	test("splits on the first slash only, since model ids contain slashes", async () => {
		const { base, ctx } = await start({});
		// A router-style id: the model id itself contains a slash.
		const handle = fauxProvider({ provider: "faux-router" });
		const routed = { ...handle.models[0]!, id: "openai/gpt-oss-120b" };
		ctx.models.registerNativeProvider({ ...handle.provider, getModels: () => [routed] });

		const response = await put(base, { ref: "faux-router/openai/gpt-oss-120b" });
		expect(response.status).toBe(200);
		await ctx.settings.reload();
		expect(ctx.settings.getDefaultProvider()).toBe("faux-router");
		expect(ctx.settings.getDefaultModel()).toBe("openai/gpt-oss-120b");
	});

	test("emits exactly one models.changed", async () => {
		const { base, ref } = await withOneModel();
		const stream = await fetch(`${base}/events`, { headers: auth });
		const reader = stream.body!.getReader();
		// The first read is the ": connected" preamble, which proves we are
		// subscribed before the PUT goes out.
		await reader.read();

		await put(base, { ref });
		const chunk = new TextDecoder().decode((await reader.read()).value);
		const changes = chunk.split("\n").filter((line) => line === "event: models.changed");
		expect(changes).toHaveLength(1);
		await reader.cancel();
	});

	test("rejects a missing or wrong bearer token before routing", async () => {
		const { base, ref } = await withOneModel();
		const noToken = await fetch(`${base}/v1/models/default`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ref }),
		});
		expect(noToken.status).toBe(401);
		const wrongToken = await fetch(`${base}/v1/models/default`, {
			method: "PUT",
			headers: { authorization: "Bearer nope", "content-type": "application/json" },
			body: JSON.stringify({ ref }),
		});
		expect(wrongToken.status).toBe(401);
	});

	/** The point of the whole route: both front doors read one file. */
	test("the write lands in the settings file the CLI reads", async () => {
		const storage = new InMemorySettingsStorage();
		const { base, ctx, ref } = await withOneModel(SettingsManager.fromStorage(storage));
		await put(base, { ref });
		await ctx.settings.flush();

		const cli = SettingsManager.fromStorage(storage);
		expect(`${cli.getDefaultProvider()}/${cli.getDefaultModel()}`).toBe(ref);
	});
});

describe("/v1/settings/telemetry", () => {
	let server: EngineServer | undefined;
	const savedEnv = process.env.KNIGHTCODE_TELEMETRY;

	afterEach(async () => {
		await server?.close();
		server = undefined;
		if (savedEnv === undefined) delete process.env.KNIGHTCODE_TELEMETRY;
		else process.env.KNIGHTCODE_TELEMETRY = savedEnv;
	});

	async function start(settings: Partial<Settings> = {}): Promise<{ base: string; ctx: EngineContext }> {
		const ctx = await createEngineContext({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			settings: SettingsManager.inMemory(settings),
		});
		server = await startEngineServer({ token: "t", routes: telemetrySettingsRoutes(ctx) });
		return { base: `http://127.0.0.1:${server.port}`, ctx };
	}

	const read = async (base: string) =>
		(await (await fetch(`${base}/v1/settings/telemetry`, { headers: auth })).json()) as {
			enabled: boolean;
			overridden: boolean;
		};

	const write = (base: string, enabled: unknown) =>
		fetch(`${base}/v1/settings/telemetry`, {
			method: "PUT",
			headers: { ...auth, "content-type": "application/json" },
			body: JSON.stringify({ enabled }),
		});

	test("defaults to on, like the CLI", async () => {
		delete process.env.KNIGHTCODE_TELEMETRY;
		const { base } = await start();
		expect(await read(base)).toEqual({ enabled: true, overridden: false });
	});

	test("a PUT of false is what the next GET reports, and what the ping reads", async () => {
		delete process.env.KNIGHTCODE_TELEMETRY;
		const { base, ctx } = await start();
		expect((await write(base, false)).status).toBe(200);
		expect(await read(base)).toEqual({ enabled: false, overridden: false });
		await ctx.settings.reload();
		expect(ctx.settings.getEnableInstallTelemetry()).toBe(false);
	});

	test("an environment override is visible, and a PUT against it is a 409", async () => {
		process.env.KNIGHTCODE_TELEMETRY = "0";
		const { base, ctx } = await start({ enableInstallTelemetry: true });
		expect(await read(base)).toEqual({ enabled: false, overridden: true });

		const response = await write(base, true);
		expect(response.status).toBe(409);
		expect(await response.text()).toContain("KNIGHTCODE_TELEMETRY");
		await ctx.settings.reload();
		expect(ctx.settings.getEnableInstallTelemetry()).toBe(true);
	});

	test("a non-boolean body is a 400", async () => {
		delete process.env.KNIGHTCODE_TELEMETRY;
		const { base } = await start();
		expect((await write(base, "yes")).status).toBe(400);
	});

	test("a body that is not JSON is a 400, not a 500", async () => {
		delete process.env.KNIGHTCODE_TELEMETRY;
		const { base } = await start();
		const res = await fetch(`${base}/v1/settings/telemetry`, { method: "PUT", headers: auth, body: "{not json" });
		expect(res.status).toBe(400);
	});

	test("rejects a missing bearer token before routing", async () => {
		delete process.env.KNIGHTCODE_TELEMETRY;
		const { base } = await start();
		expect((await fetch(`${base}/v1/settings/telemetry`)).status).toBe(401);
	});
});
