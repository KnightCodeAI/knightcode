/**
 * `knightcode plugin`: install and manage Claude Code and Grok Build plugins without starting a session. It loads no
 * extension and runs nothing a plugin ships.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { APP_NAME, CONFIG_DIR_NAME } from "../config.ts";
import { ProjectTrustStore } from "../core/trust-manager.ts";
import { loadPlugin } from "./manifest.ts";
import { describeInventory, PluginManager, type PluginScope, type PluginView, type TrustConfirm } from "./manager.ts";
import { renderPlugin } from "./render.ts";
import { copyContent } from "./store.ts";

const HELP = `${chalk.bold("Usage:")}
  ${APP_NAME} plugin install <source|name@marketplace> [--ref <ref>] [--path <dir>] [-l] [--trust]
  ${APP_NAME} plugin list [--json]
  ${APP_NAME} plugin details|enable|disable|update|uninstall <plugin> [-l]
  ${APP_NAME} plugin validate <path>
  ${APP_NAME} plugin marketplace add <source|name> [--ref <ref>] [-l]
  ${APP_NAME} plugin marketplace list [--json]
  ${APP_NAME} plugin marketplace update [<name>]
  ${APP_NAME} plugin marketplace remove <name> [-l]

Install Claude Code and Grok Build plugins: their skills, slash commands and MCP servers. A source is owner/repo, a
Git URL, a local directory, or name@marketplace. Hooks, agents, LSP servers and output styles are not run.

Anthropic's (claude-plugins-official) and xAI's (xai-official) marketplaces are built in, and the marketplaces and
plugins Claude Code and Grok Build have are listed too: list and marketplace list show them, and installing
name@marketplace from one of them adds that marketplace first.

A plugin runs nothing until you trust it: install asks in a terminal, or pass --trust. Changes apply to new and
reloaded sessions.

Options:
  -l, --local          Use the current project (${CONFIG_DIR_NAME}/settings.json) instead of your user settings
  --trust              Trust the plugin without asking (install, enable)
  --ref <ref>          Branch, tag, or full commit SHA
  --path <dir>         Plugin subdirectory inside the repository
  --json               Print JSON (list, marketplace list)`;

const HELP_HINT = chalk.dim(`Use "${APP_NAME} plugin --help" for usage.`);

export interface PluginCommandOptions {
	cwd: string;
	agentDir: string;
	/** Defaults to console output. */
	log?: (line: string) => void;
	error?: (line: string) => void;
	/** Whether the trust confirmation can be asked. Defaults to a TTY on stdin and stdout. */
	isInteractive?: boolean;
	/** Overrides the terminal confirmation. */
	confirm?: TrustConfirm;
}

interface Parsed {
	positional: string[];
	local: boolean;
	trust: boolean;
	json: boolean;
	ref?: string;
	path?: string;
}

function parse(args: string[]): Parsed | { error: string } {
	const parsed: Parsed = { positional: [], local: false, trust: false, json: false };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!;
		if (arg === "-l" || arg === "--local") parsed.local = true;
		else if (arg === "--trust") parsed.trust = true;
		else if (arg === "--json") parsed.json = true;
		else if (arg === "--ref" || arg === "--path") {
			const value = args[++index];
			if (!value) return { error: `${arg} needs a value` };
			parsed[arg === "--ref" ? "ref" : "path"] = value;
		} else if (arg.startsWith("-")) return { error: `Unknown option ${arg}` };
		else parsed.positional.push(arg);
	}
	return parsed;
}

function terminalConfirm(log: (line: string) => void): TrustConfirm {
	return async (summary) => {
		log(chalk.bold("This plugin will be able to run:"));
		for (const line of summary) log(`  ${line}`);
		const readline = createInterface({ input: process.stdin, output: process.stdout });
		try {
			return /^y(es)?$/i.test((await readline.question("Trust and activate it? [y/N] ")).trim());
		} finally {
			readline.close();
		}
	};
}

function status(plugin: PluginView, active: boolean): string {
	if (active) return chalk.green("active");
	if (!plugin.enabled) return chalk.dim("disabled");
	if (!plugin.trusted) return chalk.yellow("not trusted");
	return chalk.yellow("inactive");
}

export async function runPluginCommand(args: string[], options: PluginCommandOptions): Promise<number> {
	const log = options.log ?? ((line: string) => console.log(line));
	const error = options.error ?? ((line: string) => console.error(line));
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
		log(HELP);
		return 0;
	}
	const parsed = parse(args.slice(1));
	if ("error" in parsed) {
		error(`${parsed.error}\n${HELP_HINT}`);
		return 1;
	}
	const manager = new PluginManager({ agentDir: options.agentDir, cwd: options.cwd });
	const scope: PluginScope = parsed.local ? "project" : "user";
	const interactive = options.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
	const confirm = options.confirm ?? (interactive ? terminalConfirm(log) : undefined);
	const [target, ...rest] = parsed.positional;
	const needs = (what: string): string => {
		if (!target) throw new Error(`${args[0]} needs ${what}`);
		if (rest.length > 0 && args[0] !== "marketplace") throw new Error(`Unexpected argument ${rest[0]}`);
		return target;
	};
	const activeIdentities = () => {
		const projectTrusted = new ProjectTrustStore(options.agentDir).get(options.cwd) === true;
		return new Set(manager.loadActive(projectTrusted).plugins.map((plugin) => `${plugin.identity}\0${plugin.scope}`));
	};
	const reportTrust = (plugin: PluginView, trusted: boolean) => {
		if (!trusted) {
			log(
				chalk.yellow(
					`${plugin.name} is installed but not trusted, so it runs nothing. Activate it with: ${APP_NAME} plugin enable ${plugin.namespace}${parsed.local ? " -l" : ""} --trust`,
				),
			);
		}
	};

	try {
		switch (args[0]) {
			case "install": {
				const source = needs("a source");
				const { plugin, trusted } = await manager.install(source, {
					scope,
					trust: parsed.trust,
					...(parsed.ref ? { ref: parsed.ref } : {}),
					...(parsed.path ? { path: parsed.path } : {}),
					...(confirm ? { confirm } : {}),
				});
				log(`Installed ${plugin.name} (${scope}, ${plugin.commit.slice(0, 12)})`);
				for (const line of describeInventory(plugin.inventory)) log(`  ${line}`);
				reportTrust(plugin, trusted);
				return 0;
			}
			case "list": {
				const active = activeIdentities();
				const plugins = manager.list().map((plugin) => ({
					plugin,
					active: active.has(`${plugin.identity}\0${plugin.scopeKind}`),
				}));
				if (parsed.json) {
					log(
						JSON.stringify(
							plugins.map(({ plugin, active: isActive }) => ({
								name: plugin.name,
								namespace: plugin.namespace,
								identity: plugin.identity,
								scope: plugin.scopeKind,
								...(plugin.marketplace ? { marketplace: plugin.marketplace } : {}),
								source: plugin.source,
								...(plugin.ref ? { ref: plugin.ref } : {}),
								commit: plugin.commit,
								revision: plugin.revision,
								enabled: plugin.enabled,
								trusted: plugin.trusted,
								active: isActive,
								skills: plugin.inventory.skills.map((skill) => skill.name),
								commands: plugin.inventory.commands.map((command) => `${plugin.namespace}:${command.name}`),
								mcpServers: Object.keys(plugin.inventory.mcpServers),
								unsupported: plugin.inventory.unsupported,
								warnings: plugin.inventory.warnings,
							})),
							null,
							2,
						),
					);
					return 0;
				}
				if (plugins.length === 0) log(`No plugins installed. Add one with: ${APP_NAME} plugin install <source>`);
				for (const { plugin, active: isActive } of plugins) {
					log(`${plugin.namespace}  ${status(plugin, isActive)}  ${plugin.scopeKind}  ${chalk.dim(plugin.source)}`);
				}
				const importable = manager.importablePlugins();
				if (importable.length) {
					log("");
					log(`Installed in Claude Code or Grok Build; import one with ${APP_NAME} plugin install <name@marketplace>:`);
					for (const plugin of importable) {
						log(`  ${plugin.source}  ${chalk.dim(`${plugin.from}${plugin.enabled ? "" : ", off there"}`)}`);
					}
				}
				return 0;
			}
			case "details": {
				const plugin = manager.details(needs("a plugin name"), scope);
				log(`${plugin.identity}`);
				log(`  Scope: ${plugin.scopeKind}${plugin.marketplace ? `, from marketplace ${plugin.marketplace}` : ""}`);
				log(`  Revision: ${plugin.commit} (${plugin.revision})`);
				log(`  Enabled: ${plugin.enabled ? "yes" : "no"}, trusted: ${plugin.trusted ? "yes" : "no"}`);
				for (const line of describeInventory(plugin.inventory)) log(`  ${line}`);
				return 0;
			}
			case "enable":
			case "disable": {
				const enabled = args[0] === "enable";
				const { plugin, trusted } = await manager.setEnabled(needs("a plugin name"), enabled, {
					scope,
					trust: parsed.trust,
					...(confirm ? { confirm } : {}),
				});
				log(`${enabled ? "Enabled" : "Disabled"} ${plugin.name}. Applies to new and reloaded sessions.`);
				if (enabled) reportTrust(plugin, trusted);
				return 0;
			}
			case "update": {
				const { plugin, changed } = await manager.update(needs("a plugin name"), { scope });
				if (!changed) {
					log(`${plugin.name} is already up to date (${plugin.commit.slice(0, 12)}).`);
					return 0;
				}
				log(`Updated ${plugin.name} to ${plugin.commit.slice(0, 12)}. Running sessions keep the revision they loaded.`);
				for (const line of describeInventory(plugin.inventory)) log(`  ${line}`);
				return 0;
			}
			case "uninstall": {
				const name = needs("a plugin name");
				await manager.uninstall(name, { scope });
				log(`Uninstalled ${name}. Its data directory is kept.`);
				return 0;
			}
			case "validate": {
				const path = needs("a path");
				const copy = mkdtempSync(join(tmpdir(), "knightcode-plugin-validate-"));
				try {
					copyContent(path, join(copy, "plugin"));
					const plugin = loadPlugin(join(copy, "plugin"));
					const inventory = renderPlugin(plugin, { root: path, dataDir: join(copy, "data") });
					for (const line of describeInventory(inventory)) log(line);
				} finally {
					rmSync(copy, { recursive: true, force: true });
				}
				return 0;
			}
			case "marketplace":
				return await runMarketplaceCommand(manager, parsed, scope, log);
			default:
				error(`Unknown plugin command "${args[0]}"\n${HELP_HINT}`);
				return 1;
		}
	} catch (caught) {
		error(chalk.red(caught instanceof Error ? caught.message : String(caught)));
		return 1;
	}
}

async function runMarketplaceCommand(
	manager: PluginManager,
	parsed: Parsed,
	scope: PluginScope,
	log: (line: string) => void,
): Promise<number> {
	const [action, name] = parsed.positional;
	switch (action) {
		case "add": {
			if (!name) throw new Error("marketplace add needs a source");
			const market = await manager.addMarketplace(name, { scope, ...(parsed.ref ? { ref: parsed.ref } : {}) });
			log(`Added marketplace ${market.name} with ${market.plugins.length} plugins. Nothing is installed:`);
			for (const entry of market.plugins) log(`  ${entry.name}${entry.description ? ` - ${entry.description}` : ""}`);
			for (const diagnostic of market.diagnostics) log(chalk.yellow(`  ${diagnostic}`));
			return 0;
		}
		case "list": {
			const markets = manager.listMarketplaces();
			if (parsed.json) {
				log(JSON.stringify(markets, null, 2));
				return 0;
			}
			if (markets.length === 0) log(`No marketplaces added. Add one with: ${APP_NAME} plugin marketplace add <source>`);
			for (const market of markets) {
				log(`${market.name}  ${chalk.dim(market.source)}`);
				for (const entry of market.plugins) {
					log(
						`  ${entry.name}${entry.installed ? chalk.green(" (installed)") : ""}${entry.description ? `  ${chalk.dim(entry.description)}` : ""}`,
					);
				}
			}
			const available = manager.availableMarketplaces();
			if (available.length) {
				log("");
				log(`Not added; add one with ${APP_NAME} plugin marketplace add <name>:`);
				for (const market of available) log(`  ${market.name}  ${chalk.dim(`${market.from} · ${market.source}`)}`);
			}
			return 0;
		}
		case "update": {
			for (const market of await manager.updateMarketplaces(name)) {
				log(`Updated marketplace ${market.name} (${market.plugins.length} plugins).`);
			}
			return 0;
		}
		case "remove": {
			if (!name) throw new Error("marketplace remove needs a name");
			await manager.removeMarketplace(name, { scope });
			log(`Removed marketplace ${name}. Plugins installed from it stay installed.`);
			return 0;
		}
		default:
			throw new Error(`Unknown marketplace command "${action ?? ""}"; use add, list, update or remove`);
	}
}
