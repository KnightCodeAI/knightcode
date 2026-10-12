/**
 * Model catalog and effective settings.
 *
 * The desktop app hardcodes no model list. The default is the model the user
 * chose, read from the settings file the terminal also writes, never one the
 * server picks.
 */

import { SettingsManager } from "../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import type { AppServerContext } from "./context.ts";
import type { Handlers } from "./server.ts";

export function modelHandlers(ctx: AppServerContext): Handlers {
	return {
		"model/list": async () => {
			const available = await ctx.models.getAvailable();
			const models = available.map((model) => ({
				provider: model.provider,
				providerName: ctx.models.getProvider(model.provider)?.name ?? model.provider,
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
				input: [...model.input],
			}));
			// The terminal may have moved the choice since startup.
			await ctx.settings.reload();
			const provider = ctx.settings.getDefaultProvider();
			const id = ctx.settings.getDefaultModel();
			const chosen = provider && id ? models.find((m) => m.provider === provider && m.id === id) : undefined;
			return { models, default: chosen ? `${chosen.provider}/${chosen.id}` : null };
		},
		"config/read": async ({ cwd }) => {
			if (cwd === undefined) {
				await ctx.settings.reload();
				return { settings: ctx.settings.getSettings() };
			}
			const resolved = resolvePath(cwd);
			const trusted =
				!hasTrustRequiringProjectResources(resolved) || new ProjectTrustStore(ctx.agentDir).get(resolved) === true;
			return { settings: SettingsManager.create(resolved, ctx.agentDir, { projectTrusted: trusted }).getSettings() };
		},
	};
}
