import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxProvider, type Provider } from "@knightcode/ai";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext, type EngineContext } from "../../src/engine/context.ts";
import { modelsRoute } from "../../src/engine/models.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

const auth = { authorization: "Bearer t" };

interface ModelsBody {
	models: {
		id: string;
		providerId: string;
		providerName: string;
		name: string;
		contextWindow: number;
		maxTokens: number;
		reasoning: boolean;
		input: string[];
	}[];
}

describe("GET /v1/models", () => {
	let server: EngineServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	async function start(): Promise<{ base: string; ctx: EngineContext }> {
		const ctx = await createEngineContext({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
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

	test("never returns a credential", async () => {
		const { base, ctx } = await start();
		ctx.models.registerNativeProvider(gatedFauxProvider("faux-secret"));
		await ctx.credentials.modify("faux-secret", async () => ({ type: "api_key", key: "sk-do-not-leak" }));
		const raw = await (await fetch(`${base}/v1/models`, { headers: auth })).text();
		expect(raw).not.toContain("sk-do-not-leak");
	});
});
