/**
 * The MCP servers of active plugins, registered with `registerMcpServer()` so the MCP extension connects them with
 * the configured servers: same transports, OAuth, permission gates, tool exposure and shutdown. A server of the same
 * name in `mcp.json` overrides the plugin's. Nothing is written to `mcp.json`.
 *
 * A separate built-in from `plugins`, so `--no-mcp` turns it off with the MCP extension; servers registered while
 * nothing connects them are reported as errors.
 */

import type { ExtensionFactory } from "../../core/extensions/types.ts";
import type { McpServerConfig } from "../../core/mcp-servers.ts";
import { PluginManager } from "../../plugins/manager.ts";
import { translatePluginServers } from "../../plugins/mcp.ts";

/**
 * Emitted on the session's event bus when `/plugins` changed what is installed, trusted or enabled. The event is
 * `{ problems: string[] }`; servers that could not be registered add to it.
 */
export const PLUGINS_CHANGED_CHANNEL = "plugins-changed";

export function createPluginMcpExtension(
	options: { agentDir?: string; env?: Record<string, string | undefined> } = {},
): ExtensionFactory {
	return (knightcode) => {
		let session: { cwd: string; projectTrusted: boolean } | undefined;
		/** Registered servers and their configs, so a change starts and stops only what changed. */
		let registered = new Map<string, string>();

		const sync = (): string[] => {
			if (!session) return [];
			const { plugins } = new PluginManager({ agentDir: options.agentDir, cwd: session.cwd }).loadActive(
				session.projectTrusted,
			);
			const { servers, diagnostics } = translatePluginServers(plugins, options.env ?? process.env);
			const next = new Map(servers.map((server) => [server.name, JSON.stringify(server.config)]));
			for (const [name, config] of registered) {
				if (next.get(name) !== config) knightcode.unregisterMcpServer(name);
			}
			for (const server of servers) {
				if (registered.get(server.name) === next.get(server.name)) continue;
				try {
					knightcode.registerMcpServer(server.name, server.config as unknown as McpServerConfig);
				} catch (error) {
					next.delete(server.name);
					diagnostics.push(error instanceof Error ? error.message : String(error));
				}
			}
			registered = next;
			return diagnostics;
		};

		knightcode.on("session_start", (_event, ctx) => {
			session = { cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() };
			registered = new Map();
			for (const message of sync()) ctx.ui.notify(message, "warning");
		});
		// Plugin servers start and stop right away; skills and commands wait for a reload.
		knightcode.events.on(PLUGINS_CHANGED_CHANNEL, (data) => {
			(data as { problems: string[] }).problems.push(...sync());
		});
	};
}

export default createPluginMcpExtension();
