/**
 * Model catalog route.
 *
 * The only place the IDE learns what models exist and what they can do. The
 * IDE hardcodes no model list, so every field the picker renders is here.
 */

import type { IncomingMessage } from "node:http";
import type { ModelCost } from "@knightcode/ai";
import { isInstallTelemetryEnabled } from "../core/telemetry.ts";
import type { EngineContext } from "./context.ts";
import { type EngineRoute, sendJson } from "./server.ts";

export interface EngineModel {
	/**
	 * Provider-qualified reference to send back as `model` on a completion
	 * request. A bare `id` is not unique across providers, so clients should use
	 * this verbatim rather than assembling one.
	 */
	ref: string;
	id: string;
	providerId: string;
	providerName: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: readonly ("text" | "image")[];
	cost: ModelCost;
}

export function modelsRoute(ctx: EngineContext): EngineRoute {
	return {
		method: "GET",
		path: "/v1/models",
		handle: async (_req, res) => {
			// getAvailable() applies each provider's auth resolution, so a
			// provider with neither a stored credential nor an ambient one is
			// absent rather than listed and broken.
			const available = await ctx.models.getAvailable();
			const models: EngineModel[] = available.map((model) => ({
				ref: `${model.provider}/${model.id}`,
				id: model.id,
				providerId: model.provider,
				providerName: ctx.models.getProvider(model.provider)?.name ?? model.provider,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
			}));
			// Settings are a file the CLI writes too, so the snapshot the engine
			// took at startup goes stale the moment someone picks a different
			// model over there. Re-read instead of naming a model they left.
			await ctx.settings.reload();
			// The model the user picked, as a ref, and only when it is one of
			// the models above. A client that has to choose a default on its
			// own ends up choosing by catalog order, which is alphabetical by
			// provider and says nothing about what anyone wanted.
			const provider = ctx.settings.getDefaultProvider();
			const id = ctx.settings.getDefaultModel();
			const chosen = provider && id ? `${provider}/${id}` : undefined;
			const defaultRef = models.some((model) => model.ref === chosen) ? chosen : null;
			sendJson(res, 200, { models, default: defaultRef ?? null });
		},
	};
}

/**
 * Records which model the user chose.
 *
 * The IDE never invents one — `State::default_model` is `None` until this route
 * has been called — and the CLI's own picker writes through the same
 * `setDefaultModelAndProvider`, so both front doors agree by construction
 * rather than by being kept in step.
 */
export function setDefaultModelRoute(ctx: EngineContext): EngineRoute {
	return {
		method: "PUT",
		path: "/v1/models/default",
		handle: async (req, res) => {
			const body = await readJsonBody(req);
			const ref = typeof body.ref === "string" ? body.ref : undefined;
			if (!ref) {
				sendJson(res, 400, { error: "ref is required" });
				return;
			}
			// Model ids contain slashes ("openai/gpt-oss-120b" behind a router),
			// so only the first separator is the provider boundary.
			const separator = ref.indexOf("/");
			if (separator <= 0 || separator === ref.length - 1) {
				sendJson(res, 400, { error: "ref must be <providerId>/<modelId>" });
				return;
			}
			const provider = ref.slice(0, separator);
			const id = ref.slice(separator + 1);

			// Never record a model the user cannot reach: a ref that is not in
			// the catalog would leave every seam pointing at nothing.
			const available = await ctx.models.getAvailable();
			if (!available.some((model) => model.provider === provider && model.id === id)) {
				sendJson(res, 400, { error: `no such model: ${ref}` });
				return;
			}

			// The CLI may have moved the choice since startup, for the same
			// reason the GET handler reloads.
			await ctx.settings.reload();
			ctx.settings.setDefaultModelAndProvider(provider, id);
			// The IDE listens: EngineEvent::ModelsChanged triggers a quiet
			// refresh, so every picker repopulates with no extra wiring.
			ctx.events.publish({ type: "models.changed" });
			sendJson(res, 200, { default: ref });
		},
	};
}

/**
 * The one telemetry answer, shared by both front doors.
 *
 * First run asks the question and writes it here rather than into a second
 * settings store of the IDE's own, for the same reason there is one
 * `auth.json`: two copies of one answer means one of them is wrong.
 */
export function telemetrySettingsRoutes(ctx: EngineContext): readonly EngineRoute[] {
	return [
		{
			method: "GET",
			path: "/v1/settings/telemetry",
			handle: async (_req, res) => {
				await ctx.settings.reload();
				// The effective value, not the stored one: an environment
				// override the switch cannot see would silently contradict it.
				sendJson(res, 200, {
					enabled: isInstallTelemetryEnabled(ctx.settings),
					overridden: process.env.KNIGHTCODE_TELEMETRY !== undefined,
				});
			},
		},
		{
			method: "PUT",
			path: "/v1/settings/telemetry",
			handle: async (req, res) => {
				const body = await readJsonBody(req);
				if (typeof body.enabled !== "boolean") {
					sendJson(res, 400, { error: "enabled must be a boolean" });
					return;
				}
				if (process.env.KNIGHTCODE_TELEMETRY !== undefined) {
					// Writing a setting the environment outranks would be a lie
					// to the user, who would see the switch move and nothing else.
					sendJson(res, 409, {
						error: "KNIGHTCODE_TELEMETRY is set in the environment and takes precedence",
					});
					return;
				}
				await ctx.settings.reload();
				ctx.settings.setEnableInstallTelemetry(body.enabled);
				sendJson(res, 200, { enabled: body.enabled, overridden: false });
			},
		},
	];
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > 64 * 1024) throw new Error("body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}
