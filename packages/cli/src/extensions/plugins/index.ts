/**
 * Claude Code and Grok Build plugins in a session: their skills (through `resources_discover`) and their commands
 * and skills as `/<plugin>:<name>` commands. What is active is read from the plugin manager at session start and on
 * `/reload`; the files were rendered when the plugin was installed, so nothing is rewritten here. MCP servers are
 * registered by the `plugin-mcp` extension (./mcp.ts), so `--no-mcp` can leave them out; `/plugins` asks it to start
 * and stop them as plugins change, and leaves signing in to them to `/mcp`'s menus.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { substitutePluginArguments } from "../../plugins/arguments.ts";
import { type ActivePlugin, PluginManager } from "../../plugins/manager.ts";
import { stripFrontmatter } from "../../utils/frontmatter.ts";
import { getMcpControl } from "../mcp/control.ts";
import { PLUGINS_CHANGED_CHANNEL } from "./mcp.ts";
import { managePlugins, PluginsView } from "./ui.ts";

export interface PluginCommand {
	/** `<plugin>:<name>`. */
	name: string;
	description: string;
	/** The prompt the command sends for `args`. */
	expand(args: string): string;
}

/**
 * A description with the argument hint in front, as autocomplete draws a built-in command's hint
 * (`<hint> — <description>`): extension commands have no hint field of their own.
 */
function withHint(description: string, hint: string | undefined): string {
	return hint ? `${hint} — ${description}` : description;
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
					description: withHint(skill.description, skill.argumentHint),
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
			description: withHint(command.description, command.argumentHint),
			expand: (args: string) => {
				const body = command.content ?? stripFrontmatter(readFileSync(join(plugin.root, command.file ?? ""), "utf-8"));
				return substitutePluginArguments(body.trim(), args, command.arguments);
			},
		})),
	]);
}

export function createPluginsExtension(options: { agentDir?: string } = {}): ExtensionFactory {
	return (knightcode) => {
		let skillPaths: string[] = [];
		knightcode.on("session_start", (_event, ctx) => {
			const manager = new PluginManager({ agentDir: options.agentDir, cwd: ctx.cwd });
			const { plugins, diagnostics } = manager.loadActive(ctx.isProjectTrusted());
			// The exact skill files, never their directories.
			skillPaths = plugins.flatMap((plugin) => plugin.inventory.skills.map((skill) => join(plugin.root, skill.file)));
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
		knightcode.registerCommand("plugins", {
			description: "Install, trust, enable, update and remove plugins",
			handler: async (_args, ctx) => {
				if (ctx.mode !== "tui") {
					ctx.ui.notify("/plugins needs the terminal UI; use knightcode plugin instead.", "warning");
					return;
				}
				const manager = new PluginManager({ agentDir: options.agentDir, cwd: ctx.cwd });
				const control = getMcpControl(knightcode.events);
				let reload = false;
				await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
					const view = new PluginsView(tui, theme, keybindings);
					void managePlugins(view, manager, {
						reload: async () => {
							reload = true;
						},
						...(control
							? { mcp: { ...control, manage: (names, ui, action) => control.manage(names, ui, ctx, action) } }
							: {}),
						applyMcp: () => {
							const event = { problems: [] as string[] };
							knightcode.events.emit(PLUGINS_CHANGED_CHANNEL, event);
							return event.problems;
						},
					})
						.catch((error: unknown) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"))
						.finally(() => done());
					return view;
				});
				if (reload) await ctx.reload();
			},
		});
	};
}

export default createPluginsExtension();
