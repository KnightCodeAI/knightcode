/**
 * Model catalog and effective settings.
 *
 * The desktop app hardcodes no model list. The default is the model the user
 * chose, read from the settings file the terminal also writes, never one the
 * server picks.
 */

import { stat } from "node:fs/promises";
import { getSupportedThinkingLevels } from "@knightcode/ai";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import { projectReadable, readSettings, writeSetting } from "./config.ts";
import { AppServerError } from "./errors.ts";
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
				thinkingLevels: getSupportedThinkingLevels(model),
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
			const resolved = cwd === undefined ? undefined : resolvePath(cwd);
			return readSettings(ctx.agentDir, resolved, resolved !== undefined && projectReadable(ctx.agentDir, resolved));
		},
		"config/write": async ({ scope, cwd, key, value, expectedVersion }) => {
			const resolved = cwd === undefined ? undefined : resolvePath(cwd);
			if (scope === "project") {
				if (resolved === undefined) throw new AppServerError("invalidParams", "project writes require cwd");
				if (new ProjectTrustStore(ctx.agentDir).get(resolved) !== true)
					throw new AppServerError("invalidParams", "project is not trusted", { reason: "untrusted" });
			}
			const keyPath = key.split(".");
			if (keyPath.some((part) => part === "" || part === "__proto__" || part === "constructor" || part === "prototype"))
				throw new AppServerError("invalidParams", "invalid settings key");
			const result = writeSetting(ctx.agentDir, resolved, scope, keyPath, value, expectedVersion);
			if (!result.ok)
				throw new AppServerError("configConflict", "settings changed since they were read", {
					version: result.version,
				});
			if (scope === "global") await ctx.settings.reload();
			return { version: result.version };
		},
		"project/trust/read": async ({ cwd }) => {
			const resolved = resolvePath(cwd);
			return {
				trusted: new ProjectTrustStore(ctx.agentDir).get(resolved),
				needsTrust: hasTrustRequiringProjectResources(resolved),
			};
		},
		"project/trust/set": async ({ cwd, trusted }) => {
			const resolved = resolvePath(cwd);
			// A typo would otherwise leave a permanent trust entry for a path that is not a project.
			const stats = await stat(resolved).catch(() => undefined);
			if (!stats?.isDirectory()) throw new AppServerError("invalidParams", `cwd is not a directory: ${cwd}`);
			new ProjectTrustStore(ctx.agentDir).set(resolved, trusted);
			return {};
		},
	};
}
