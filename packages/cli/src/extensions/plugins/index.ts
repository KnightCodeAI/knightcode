/**
 * Claude Code and Grok Build plugins in a session: their skills (through `resources_discover`) and their commands
 * and skills as `/<plugin>:<name>` commands. What is active is read from the plugin manager at session start and on
 * `/reload`; the files were rendered when the plugin was installed, so nothing is rewritten here. MCP servers are
 * registered by the `plugin-mcp` extension (./mcp.ts), so `--no-mcp` can leave them out.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { substitutePluginArguments } from "../../plugins/arguments.ts";
import { type ActivePlugin, PluginManager } from "../../plugins/manager.ts";
import { stripFrontmatter } from "../../utils/frontmatter.ts";

export interface PluginCommand {
	/** `<plugin>:<name>`. */
	name: string;
	description: string;
	/** The prompt the command sends for `args`. */
	expand(args: string): string;
}

/** The `/<plugin>:<name>` commands of the active plugins: each command, and each skill users may invoke. */
export function pluginCommands(plugins: readonly ActivePlugin[]): PluginCommand[] {
	return plugins.flatMap((plugin) => [
		...plugin.inventory.skills
			.filter((skill) => skill.userInvocable)
			.map((skill) => {
				const file = join(plugin.root, skill.file);
				return {
					name: skill.name,
					description: skill.description,
					// The block `/skill:<name>` sends (agent-session.ts), with the arguments in the plugin dialect.
					expand: (args: string) => {
						const body = substitutePluginArguments(
							stripFrontmatter(readFileSync(file, "utf-8")).trim(),
							args,
							skill.arguments,
						);
						return `<skill name="${skill.name}" location="${file}">\nReferences are relative to ${dirname(file)}.\n\n${body}\n</skill>`;
					},
				};
			}),
		...plugin.inventory.commands.map((command) => ({
			name: `${plugin.namespace}:${command.name}`,
			description: command.description,
			expand: (args: string) => {
				const body = command.content ?? stripFrontmatter(readFileSync(join(plugin.root, command.file ?? ""), "utf-8"));
				return substitutePluginArguments(body.trim(), args, command.arguments);
			},
		})),
	]);
}

/** Every skill file of the active plugins: the exact files, never their directories. */
export function pluginSkillPaths(plugins: readonly ActivePlugin[]): string[] {
	return plugins.flatMap((plugin) => plugin.inventory.skills.map((skill) => join(plugin.root, skill.file)));
}

export function createPluginsExtension(options: { agentDir?: string } = {}): ExtensionFactory {
	return (knightcode) => {
		let skillPaths: string[] = [];
		knightcode.on("session_start", (_event, ctx) => {
			const manager = new PluginManager({ agentDir: options.agentDir, cwd: ctx.cwd });
			const { plugins, diagnostics } = manager.loadActive(ctx.isProjectTrusted());
			skillPaths = pluginSkillPaths(plugins);
			for (const command of pluginCommands(plugins)) {
				knightcode.registerCommand(command.name, {
					description: command.description,
					handler: async (args, commandCtx) => {
						// The command context's sendUserMessage awaits the run and reports acceptance to the app server.
						await commandCtx.sendUserMessage(
							command.expand(args),
							commandCtx.isIdle() ? undefined : { deliverAs: "followUp" },
						);
					},
				});
			}
			for (const message of diagnostics) ctx.ui.notify(message, "warning");
		});
		knightcode.on("resources_discover", () => ({ skillPaths }));
	};
}

export default createPluginsExtension();
