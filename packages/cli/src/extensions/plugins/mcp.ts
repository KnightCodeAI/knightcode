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

export function createPluginMcpExtension(
	options: { agentDir?: string; env?: Record<string, string | undefined> } = {},
): ExtensionFactory {
	return (knightcode) => {
		knightcode.on("session_start", (_event, ctx) => {
			const { plugins } = new PluginManager({ agentDir: options.agentDir, cwd: ctx.cwd }).loadActive(
				ctx.isProjectTrusted(),
			);
			const { servers, diagnostics } = translatePluginServers(plugins, options.env ?? process.env);
			for (const server of servers) {
				try {
					knightcode.registerMcpServer(server.name, server.config as unknown as McpServerConfig);
				} catch (error) {
					diagnostics.push(error instanceof Error ? error.message : String(error));
				}
			}
			for (const message of diagnostics) ctx.ui.notify(message, "warning");
		});
	};
}

export default createPluginMcpExtension();
