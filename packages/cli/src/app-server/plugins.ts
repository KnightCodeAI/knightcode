/**
 * Plugins for the desktop: the same `PluginManager` the CLI and `/plugins` use. Reads look at local state only;
 * nothing is fetched, installed or run except by the install, update and marketplace methods, and an installed
 * plugin runs nothing until it is trusted. Project writes need a project the user trusted.
 */

import type { ParamsOf, PluginInfo, PluginMarketplaceInfo } from "@knightcode/app-server-protocol";
import { describeMcpServer, mcpEnvironmentNames } from "../plugins/mcp.ts";
import {
	type ActivePlugin,
	type MarketplaceView,
	PluginManager,
	type PluginScope,
	type PluginView,
} from "../plugins/manager.ts";
import { resolvePath } from "../utils/paths.ts";
import { trustedProject } from "./configure.ts";
import type { AppServerContext } from "./context.ts";
import type { Handlers } from "./server.ts";
import { projectReadable } from "./workspaces.ts";

type Scope = ParamsOf<"plugin/install">["scope"];

function marketplaceInfo(market: MarketplaceView): PluginMarketplaceInfo {
	return { ...market, scope: market.scope === "user" ? "global" : "project" };
}

export function pluginHandlers(ctx: AppServerContext): Handlers {
	/** Without a project, the agent directory stands in: it has no `.knightcode` of its own. */
	const managerFor = (cwd: string | undefined) =>
		new PluginManager({ agentDir: ctx.agentDir, cwd: cwd === undefined ? ctx.agentDir : resolvePath(cwd) });
	/** A manager for writing `scope`; project writes need a trusted project. */
	const writer = (scope: Scope, cwd: string | undefined) =>
		scope === "project" ? managerFor(trustedProject(ctx.agentDir, cwd)) : managerFor(cwd);
	const scopeOf = (scope: Scope): PluginScope => (scope === "global" ? "user" : "project");

	const loadActive = (manager: PluginManager, cwd: string | undefined) =>
		manager.loadActive(cwd !== undefined && projectReadable(ctx.agentDir, resolvePath(cwd)));

	const info = (plugin: PluginView, active: readonly ActivePlugin[]): PluginInfo => {
		const { inventory } = plugin;
		return {
			name: plugin.name,
			namespace: plugin.namespace,
			identity: plugin.identity,
			scope: plugin.scopeKind === "user" ? "global" : "project",
			...(plugin.marketplace ? { marketplace: plugin.marketplace } : {}),
			source: plugin.source,
			...(plugin.ref ? { ref: plugin.ref } : {}),
			commit: plugin.commit,
			enabled: plugin.enabled,
			trusted: plugin.trusted,
			active: active.some(
				(candidate) => candidate.identity === plugin.identity && candidate.scope === plugin.scopeKind,
			),
			...(inventory.description ? { description: inventory.description } : {}),
			...(inventory.version ? { version: inventory.version } : {}),
			skills: inventory.skills.map((skill) => skill.name),
			commands: inventory.commands.map((command) => `${inventory.namespace}:${command.name}`),
			mcpServers: Object.entries(inventory.mcpServers).map(([name, config]) => ({
				name,
				target: describeMcpServer(config),
			})),
			environment: mcpEnvironmentNames(inventory.mcpServers),
			unsupported: inventory.unsupported,
			warnings: inventory.warnings,
		};
	};

	return {
		"plugin/list": async ({ cwd }) => {
			const manager = managerFor(cwd);
			const { plugins: active, diagnostics } = loadActive(manager, cwd);
			return {
				plugins: manager.list().map((plugin) => info(plugin, active)),
				diagnostics,
				importable: manager.importablePlugins(),
			};
		},
		"plugin/install": async ({ scope, cwd, source, ref, path, trust }) => {
			const manager = writer(scope, cwd);
			const { plugin } = await manager.install(source, {
				scope: scopeOf(scope),
				trust: trust === true,
				...(ref ? { ref } : {}),
				...(path ? { path } : {}),
			});
			return { plugin: info(plugin, loadActive(manager, cwd).plugins) };
		},
		"plugin/set": async ({ scope, cwd, name, enabled, trust }) => {
			const manager = writer(scope, cwd);
			const current = manager.details(name, scopeOf(scope));
			const { plugin } = await manager.setEnabled(name, enabled ?? (trust === true ? true : current.enabled), {
				scope: scopeOf(scope),
				trust: trust === true,
			});
			return { plugin: info(plugin, loadActive(manager, cwd).plugins) };
		},
		"plugin/update": async ({ scope, cwd, name }) => {
			const manager = writer(scope, cwd);
			const { plugin, changed } = await manager.update(name, { scope: scopeOf(scope) });
			return { plugin: info(plugin, loadActive(manager, cwd).plugins), changed };
		},
		"plugin/uninstall": async ({ scope, cwd, name }) => {
			await writer(scope, cwd).uninstall(name, { scope: scopeOf(scope) });
			return {};
		},
		"plugin/marketplace/list": async ({ cwd }) => {
			const manager = managerFor(cwd);
			return {
				marketplaces: manager.listMarketplaces().map(marketplaceInfo),
				available: manager.availableMarketplaces(),
			};
		},
		"plugin/marketplace/add": async ({ scope, cwd, source, ref }) => ({
			marketplace: marketplaceInfo(
				await writer(scope, cwd).addMarketplace(source, { scope: scopeOf(scope), ...(ref ? { ref } : {}) }),
			),
		}),
		"plugin/marketplace/update": async ({ cwd, name }) => ({
			marketplaces: (await managerFor(cwd).updateMarketplaces(name)).map(marketplaceInfo),
		}),
		"plugin/marketplace/remove": async ({ scope, cwd, name }) => {
			await writer(scope, cwd).removeMarketplace(name, { scope: scopeOf(scope) });
			return {};
		},
	};
}
