/**
 * `/plugins`: one searchable picker over installed plugins and marketplace catalogs, with details, trust, install,
 * enable and disable, update, uninstall and reload. Mounted with `ctx.ui.custom`, so terminal only.
 */

import {
	type Component,
	Container,
	type Focusable,
	Input,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
	type TUI,
} from "@knightcode/tui";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { getSelectListTheme, type Theme } from "../../modes/interactive/theme/theme.ts";
import { describeInventory, type PluginManager, type PluginScope, type TrustConfirm } from "../../plugins/manager.ts";

export interface PluginMenu {
	title: string;
	/** Lines shown below the title. */
	details?: string[];
	items: SelectItem[];
	/** Shows a search field that filters the items by label and description. */
	search?: boolean;
	confirmLabel: string;
	cancelLabel: string;
}

export interface PluginsUi {
	/** Resolves to the chosen item's value, or undefined when cancelled. */
	menu(menu: PluginMenu): Promise<string | undefined>;
	/** Shows a message while an operation runs. */
	status(title: string, message: string): void;
}

const MAX_VISIBLE_ITEMS = 12;
const LIST_KEYS = [
	"tui.select.up",
	"tui.select.down",
	"tui.select.pageUp",
	"tui.select.pageDown",
	"tui.select.confirm",
	"tui.select.cancel",
] as const;

export class PluginsView implements PluginsUi, Component, Focusable {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private content: Container;
	private inputHandler: ((data: string) => void) | undefined;
	private search: Input | undefined;
	private _focused = false;

	constructor(tui: TUI, theme: Theme, keybindings: KeybindingsManager) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.content = this.frame("Plugins", [new Text(theme.fg("muted", "Loading…"), 1, 1)]);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		if (this.search) this.search.focused = value;
	}

	private frame(title: string, body: Component[], footer?: string): Container {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
		container.addChild(new Text(this.theme.fg("accent", this.theme.bold(title)), 1, 0));
		for (const child of body) container.addChild(child);
		if (footer) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(this.theme.fg("dim", footer), 1, 0));
		}
		container.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
		return container;
	}

	private show(content: Container, inputHandler?: (data: string) => void, search?: Input): void {
		if (this.search) this.search.focused = false;
		this.content = content;
		this.inputHandler = inputHandler;
		this.search = search;
		if (search) search.focused = this._focused;
		this.tui.requestRender();
	}

	menu(menu: PluginMenu): Promise<string | undefined> {
		return new Promise((resolve) => {
			const search = menu.search ? new Input() : undefined;
			let selected: string | undefined;
			const render = () => {
				const filter = search?.getValue().trim().toLowerCase() ?? "";
				const items = filter
					? menu.items.filter((item) => `${item.label} ${item.description ?? ""}`.toLowerCase().includes(filter))
					: menu.items;
				const body: Component[] = (menu.details ?? []).map((line) => new Text(this.theme.fg("muted", line), 1, 0));
				if (search) body.push(search);
				body.push(new Spacer(1));
				const list = new SelectList(
					items,
					Math.max(1, Math.min(items.length, MAX_VISIBLE_ITEMS)),
					getSelectListTheme(),
				);
				const index = items.findIndex((item) => item.value === selected);
				if (index !== -1) list.setSelectedIndex(index);
				list.onSelectionChange = (item) => {
					selected = item.value;
				};
				list.onSelect = (item) => resolve(item.value);
				list.onCancel = () => resolve(undefined);
				body.push(items.length ? list : new Text(this.theme.fg("muted", "Nothing matches."), 1, 0));
				const footer = `${keyHint("tui.select.confirm", menu.confirmLabel)} • ${keyHint("tui.select.cancel", menu.cancelLabel)}`;
				this.show(
					this.frame(menu.title, body, footer),
					(data) => {
						if (!search || LIST_KEYS.some((key) => this.keybindings.matches(data, key))) {
							if (items.length) list.handleInput(data);
							else if (this.keybindings.matches(data, "tui.select.cancel")) resolve(undefined);
							return;
						}
						search.handleInput(data);
						render();
					},
					search,
				);
			};
			render();
		});
	}

	status(title: string, message: string): void {
		this.show(this.frame(title, [new Text(this.theme.fg("muted", message), 1, 1)]));
	}

	handleInput(data: string): void {
		this.inputHandler?.(data);
	}

	render(width: number): string[] {
		return this.content.render(width);
	}

	invalidate(): void {
		this.content.invalidate();
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface ManagePluginsOptions {
	notify: (message: string, type?: "info" | "warning" | "error") => void;
	/** Reloads the session, which applies plugin changes. */
	reload: () => Promise<void>;
	/** Whether the current project is trusted, which project installs need. */
	projectTrusted: boolean;
}

/** Runs the `/plugins` menus until the user leaves; offers a reload when something changed. */
export async function managePlugins(
	ui: PluginsUi,
	manager: PluginManager,
	options: ManagePluginsOptions,
): Promise<void> {
	let changed = false;
	const confirmTrust: TrustConfirm = async (summary, inventory) =>
		(await ui.menu({
			title: `Trust ${inventory.name}?`,
			details: ["Trusting a plugin lets it run its MCP servers and use its skills and commands:", ...summary],
			items: [
				{ value: "yes", label: "Trust and activate" },
				{ value: "no", label: "Do not trust" },
			],
			confirmLabel: "choose",
			cancelLabel: "do not trust",
		})) === "yes";
	const run = async (title: string, message: string, action: () => Promise<string>) => {
		ui.status(title, message);
		try {
			options.notify(await action(), "info");
		} catch (error) {
			options.notify(errorText(error), "error");
		}
	};

	while (true) {
		const installed = manager.list();
		let markets: ReturnType<PluginManager["listMarketplaces"]> = [];
		try {
			markets = manager.listMarketplaces();
		} catch {}
		const items: SelectItem[] = [
			...installed.map((plugin) => ({
				value: `plugin:${plugin.scopeKind}:${plugin.namespace}`,
				label: plugin.namespace,
				description: `${!plugin.enabled ? "disabled" : plugin.trusted ? "enabled" : "not trusted"} · ${plugin.scopeKind}${plugin.inventory.description ? ` · ${plugin.inventory.description}` : ""}`,
			})),
			...markets.flatMap((market) =>
				market.plugins
					.filter((entry) => !entry.installed)
					.map((entry) => ({
						value: `entry:${entry.name}@${market.name}`,
						label: `${entry.name}@${market.name}`,
						description: `available${entry.description ? ` · ${entry.description}` : ""}`,
					})),
			),
			{ value: "reload", label: "Reload session", description: "apply plugin changes now" },
		];
		const choice = await ui.menu({
			title: "Plugins",
			details:
				installed.length || markets.length
					? undefined
					: ["No plugins or marketplaces yet. Use knightcode plugin install <source>."],
			items,
			search: true,
			confirmLabel: "open",
			cancelLabel: "close",
		});
		if (choice === undefined) break;
		if (choice === "reload") {
			await options.reload();
			return;
		}
		if (choice.startsWith("entry:")) {
			const source = choice.slice("entry:".length);
			const scope = await ui.menu({
				title: `Install ${source}`,
				items: [
					{ value: "user", label: "Install for me", description: "user settings" },
					...(options.projectTrusted
						? [{ value: "project", label: "Install in this project", description: "project settings" }]
						: []),
				],
				confirmLabel: "install",
				cancelLabel: "back",
			});
			if (!scope) continue;
			await run(`Installing ${source}`, "Fetching and checking the plugin…", async () => {
				const { plugin, trusted } = await manager.install(source, {
					scope: scope as PluginScope,
					confirm: confirmTrust,
				});
				changed = true;
				return trusted
					? `Installed ${plugin.name}.`
					: `Installed ${plugin.name}; it stays inactive until you trust it.`;
			});
			continue;
		}
		const [, scopeKind, name] = choice.split(":") as [string, PluginScope, string];
		const plugin = installed.find((candidate) => candidate.scopeKind === scopeKind && candidate.namespace === name);
		if (!plugin) continue;
		const action = await ui.menu({
			title: plugin.name,
			details: [`${plugin.scopeKind} · ${plugin.source} · ${plugin.commit.slice(0, 12)}`],
			items: [
				{ value: "details", label: "Details", description: "what it offers and runs" },
				...(!plugin.enabled || !plugin.trusted
					? [{ value: "enable", label: plugin.trusted ? "Enable" : "Trust and enable" }]
					: [{ value: "disable", label: "Disable" }]),
				{ value: "update", label: "Update", description: "fetch its source again" },
				{ value: "uninstall", label: "Uninstall" },
			],
			confirmLabel: "choose",
			cancelLabel: "back",
		});
		if (action === "details") {
			await ui.menu({
				title: plugin.name,
				details: [plugin.identity, ...describeInventory(plugin.inventory)],
				items: [{ value: "back", label: "Back" }],
				confirmLabel: "back",
				cancelLabel: "back",
			});
		} else if (action === "enable" || action === "disable") {
			const enabled = action === "enable";
			await run(`${enabled ? "Enabling" : "Disabling"} ${plugin.name}`, "Saving…", async () => {
				const result = await manager.setEnabled(plugin.namespace, enabled, { scope: scopeKind, confirm: confirmTrust });
				if (enabled && !result.trusted) return `${plugin.name} is not trusted and stays inactive.`;
				changed = true;
				return `${enabled ? "Enabled" : "Disabled"} ${plugin.name}.`;
			});
		} else if (action === "update") {
			await run(`Updating ${plugin.name}`, "Fetching its source…", async () => {
				const result = await manager.update(plugin.namespace, { scope: scopeKind });
				if (result.changed) changed = true;
				return result.changed ? `Updated ${plugin.name}.` : `${plugin.name} is already up to date.`;
			});
		} else if (action === "uninstall") {
			const sure = await ui.menu({
				title: `Uninstall ${plugin.name}?`,
				details: ["Its data directory is kept."],
				items: [
					{ value: "yes", label: "Uninstall" },
					{ value: "no", label: "Keep it" },
				],
				confirmLabel: "choose",
				cancelLabel: "keep it",
			});
			if (sure !== "yes") continue;
			await run(`Uninstalling ${plugin.name}`, "Removing…", async () => {
				await manager.uninstall(plugin.namespace, { scope: scopeKind });
				changed = true;
				return `Uninstalled ${plugin.name}.`;
			});
		}
	}
	if (!changed) return;
	const reload = await ui.menu({
		title: "Apply plugin changes?",
		details: ["Changes apply to new and reloaded sessions."],
		items: [
			{ value: "reload", label: "Reload this session now" },
			{ value: "later", label: "Later" },
		],
		confirmLabel: "choose",
		cancelLabel: "later",
	});
	if (reload === "reload") await options.reload();
}
