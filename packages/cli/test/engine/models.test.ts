import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxProvider, type Provider } from "@knightcode/ai";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext, type EngineContext } from "../../src/engine/context.ts";
import { modelsRoute } from "../../src/engine/models.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";
import { InMemorySettingsStorage, SettingsManager, type Settings } from "../../src/core/settings-manager.ts";

const auth = { authorization: "Bearer t" };

interface ModelsBody {
	models: {
		ref: string;
		id: string;
		providerId: string;
		providerName: string;
		name: string;
		contextWindow: number;
		maxTokens: number;
		reasoning: boolean;
		input: string[];
	}[];
	default: string | null;
}

describe("GET /v1/models", () => {
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
		server = await startEngineServer({ token: "t", routes: [modelsRoute(ctx)] });
		return { base: `http://127.0.0.1:${server.port}`, ctx };
	}

	/**
	 * The stock faux provider resolves auth unconditionally, so it is always
	 * available. Gate it on a stored key to exercise the credential path. The
	 * ambient environment is deliberately not asserted on: a machine with
	 * ANTHROPIC_API_KEY set legitimately has models available with nothing
	 * stored, so every assertion here is scoped to this provider id.
	 */
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

	test("omits a provider with no credential", async () => {
		const { base, ctx } = await start();
		ctx.models.registerNativeProvider(gatedFauxProvider("faux-gated-absent"));
		const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(body.models.filter((model) => model.providerId === "faux-gated-absent")).toEqual([]);
	});

	test("includes a provider once a credential is stored", async () => {
		const { base, ctx } = await start();
		ctx.models.registerNativeProvider(gatedFauxProvider("faux-gated-present"));
		await ctx.credentials.modify("faux-gated-present", async () => ({ type: "api_key", key: "stored-key" }));

		const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		const mine = body.models.filter((model) => model.providerId === "faux-gated-present");
		expect(mine.length).toBeGreaterThan(0);
	});

	test("carries every field the model picker needs", async () => {
		const { base, ctx } = await start();
		ctx.models.registerNativeProvider(gatedFauxProvider("faux-fields"));
		await ctx.credentials.modify("faux-fields", async () => ({ type: "api_key", key: "stored-key" }));

		const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		const model = body.models.find((entry) => entry.providerId === "faux-fields");
		expect(model).toBeDefined();
		expect(typeof model!.id).toBe("string");
		expect(typeof model!.name).toBe("string");
		expect(typeof model!.providerName).toBe("string");
		expect(typeof model!.contextWindow).toBe("number");
		expect(typeof model!.maxTokens).toBe("number");
		expect(typeof model!.reasoning).toBe("boolean");
		expect(Array.isArray(model!.input)).toBe(true);
	});

	/**
	 * The IDE has no business choosing which of someone's accounts gets spent.
	 * The CLI already records what they picked, so the catalog reports it and
	 * the IDE uses that or nothing.
	 */
	test("reports the default the user set, as a provider-qualified ref", async () => {
		const { base, ctx } = await start({});
		ctx.models.registerNativeProvider(gatedFauxProvider("faux-default"));
		await ctx.credentials.modify("faux-default", async () => ({ type: "api_key", key: "stored-key" }));

		const before = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(before.default).toBeNull();
		const mine = before.models.find((model) => model.providerId === "faux-default");
		expect(mine).toBeDefined();

		// What the CLI writes when someone picks a model.
		ctx.settings.setDefaultModelAndProvider(mine!.providerId, mine!.id);

		const after = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(after.default).toBe(mine!.ref);
	});

	/**
	 * The CLI and the engine are separate processes over one settings file, so
	 * the engine cannot answer from the snapshot it read at startup: whoever is
	 * in the CLI may have moved to another model since.
	 */
	test("reports a default the CLI set after the engine started", async () => {
		const storage = new InMemorySettingsStorage();
		const { base, ctx } = await start(undefined, SettingsManager.fromStorage(storage));
		ctx.models.registerNativeProvider(gatedFauxProvider("faux-late-default"));
		await ctx.credentials.modify("faux-late-default", async () => ({ type: "api_key", key: "stored-key" }));

		const before = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(before.default).toBeNull();
		const mine = before.models.find((model) => model.providerId === "faux-late-default");
		expect(mine).toBeDefined();

		// A concurrently running CLI: its own manager over the same file.
		const cli = SettingsManager.fromStorage(storage);
		cli.setDefaultModelAndProvider(mine!.providerId, mine!.id);
		await cli.flush();

		const after = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(after.default).toBe(mine!.ref);
	});

	test("reports no default when the user has set none", async () => {
		const { base } = await start({});
		const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(body.default).toBeNull();
	});

	/**
	 * A default naming a provider that is signed out would send the IDE to a
	 * model it cannot use; absent is the honest answer.
	 */
	test("reports no default when the model the user set is unavailable", async () => {
		const { base } = await start({ defaultProvider: "faux-signed-out", defaultModel: "faux" });
		const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as ModelsBody;
		expect(body.models.filter((model) => model.providerId === "faux-signed-out")).toEqual([]);
		expect(body.default).toBeNull();
	});

	test("never returns a credential", async () => {
		const { base, ctx } = await start();
		ctx.models.registerNativeProvider(gatedFauxProvider("faux-secret"));
		await ctx.credentials.modify("faux-secret", async () => ({ type: "api_key", key: "sk-do-not-leak" }));
		const raw = await (await fetch(`${base}/v1/models`, { headers: auth })).text();
		expect(raw).not.toContain("sk-do-not-leak");
	});
});
