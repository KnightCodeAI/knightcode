/**
 * `/plugins`, laid out as Grok Build's plugin screen. Two tabs share one search: Plugins (installed, and the ones
 * Claude Code and Grok Build have to import) and Marketplace (the added catalogs, and the marketplaces not added
 * yet). Rows carry their state and the keys that act on them.
 *
 * MCP servers stay with `/mcp`: a plugin's row shows its servers' state and opens `/mcp`'s menus for them, and an
 * install whose server asks for a sign-in opens them itself. Mounted with `ctx.ui.custom`, so terminal only.
 */

import { homedir } from "node:os";
import {
	type Component,
	type Focusable,
	Input,
	type Keybinding,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@knightcode/tui";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { isOfflineModeEnabled } from "../../core/package-manager.ts";
import { plural } from "../../core/tools/render-utils.ts";
import { keyHint, keyText, rawKeyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { getSelectListTheme, type Theme } from "../../modes/interactive/theme/theme.ts";
import {
	describeInventory,
	type ImportablePlugin,
	type MarketplaceListing,
	type PluginManager,
	type PluginView,
	type TrustConfirm,
} from "../../plugins/manager.ts";
import { pluginServerName } from "../../plugins/render.ts";
import { parseSource } from "../../plugins/sources.ts";
import type { McpServerSummary } from "../mcp/control.ts";
import { frame, McpManagerView, type McpUi } from "../mcp/ui.ts";

export interface PluginMenu {
	title: string;
	/** Lines shown below the title. */
	details?: string[];
	items: SelectItem[];
	confirmLabel: string;
	cancelLabel: string;
}

export type PluginsTab = "plugins" | "marketplace";

export interface Badge {
	text: string;
	tone: "success" | "warning" | "error" | "muted" | "accent";
}

export interface BrowseRow {
	/** Names the row across rebuilds and in actions. */
	key: string;
	label: string;
	/** Dim text after the label: a version, a marketplace. */
	right?: string;
	/** One dim line under the label. */
	description?: string;
	/** Shown under the row when enter opens it. */
	details?: string[];
	badge?: Badge;
	dimmed?: boolean;
	/** What each action does here (an `ACTION_KEYBINDINGS` name), to its hint. */
	actions: Record<string, string>;
}

/** The keybinding behind each action name rows and tabs offer; the first match wins. */
const ACTION_KEYBINDINGS = {
	enter: "tui.select.confirm",
	space: "app.plugins.toggle",
	a: "app.plugins.add",
	r: "app.plugins.refresh",
	u: "app.plugins.update",
	x: "app.plugins.remove",
	d: "app.plugins.uninstall",
	i: "app.plugins.install",
	m: "app.plugins.mcp",
} as const satisfies Record<string, Keybinding>;
type ActionName = keyof typeof ACTION_KEYBINDINGS;
const ACTION_NAMES = Object.keys(ACTION_KEYBINDINGS) as ActionName[];

/** The keys an action is bound to, for hints and screen text. */
function actionKey(name: ActionName): string {
	return keyText(ACTION_KEYBINDINGS[name]);
}

export interface BrowseGroup {
	key: string;
	label: string;
	right?: string;
	badge?: Badge;
	/** Keys on the group's own line; enter expands or collapses it otherwise. */
	actions?: Record<string, string>;
	/** Starts collapsed the first time it is shown. */
	collapsed?: boolean;
	rows: BrowseRow[];
}

export interface BrowseTab {
	id: PluginsTab;
	label: string;
	groups: BrowseGroup[];
	/** Keys that act on the tab wherever the selection is. */
	actions: Record<string, string>;
	/** Shown when the tab has nothing. */
	empty: string;
}

export interface BrowseAction {
	tab: PluginsTab;
	/** The action's name: `enter`, `space`, or the letter of its default key. */
	key: string;
	/** The selected row or group. */
	target?: string;
}

export interface BrowseOptions {
	/** Rebuilds the tabs on every change, keeping the tab, search and selection. */
	subscribe?: (listener: () => void) => () => void;
	/** Switches to a tab and selects a row or group, once. */
	focus?: { tab: PluginsTab; key?: string };
	/** What the last action did. */
	notice?: { text: string; error?: boolean };
}

export interface PluginsUi {
	/** Shows the tabs until a key acts; resolves to that action, or undefined when the user leaves. */
	browse(build: () => BrowseTab[], options?: BrowseOptions): Promise<BrowseAction | undefined>;
	/** Resolves to the chosen item's value, or undefined when cancelled. */
	menu(menu: PluginMenu): Promise<string | undefined>;
	/** Asks for one line of text; undefined when cancelled or empty. */
	input(title: string, placeholder: string): Promise<string | undefined>;
	/** Shows a message while an operation runs. */
	status(title: string, message: string): void;
	/** `/mcp`'s screen, shown in place of this one until the next call. */
	mcpUi(): McpUi;
}

const MAX_VISIBLE_ITEMS = 12;
const MAX_VISIBLE_ROWS = 10;

type Item =
	| { kind: "group"; group: BrowseGroup; count: number; collapsed: boolean }
	| { kind: "row"; row: BrowseRow; group: BrowseGroup };

const itemKey = (item: Item) => (item.kind === "row" ? item.row.key : item.group.key);

type InputHandler = Pick<Component, "handleInput" | "capturesViewportInput">;
/** A list screen's keys, which include the fullscreen viewport keys (PageUp, PageDown). */
const listInput = (handleInput: (data: string) => void): InputHandler => ({ handleInput, capturesViewportInput: true });

/** Lines drawn at render time, for the list whose layout depends on the width. */
class Lines implements Component {
	private readonly draw: (width: number) => string[];
	constructor(draw: (width: number) => string[]) {
		this.draw = draw;
	}
	render(width: number): string[] {
		return this.draw(width);
	}
	invalidate(): void {}
}

/** A catalog's description or git's stderr on one line: a newline inside a rendered line breaks the screen. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

/**
 * `text` wrapped inside a one-column margin and cut to `rows` lines, the last ending in "…": a plugin with hundreds of
 * skills, or a whole stderr, still leaves the screen's choices in view.
 */
const capped = (text: string, rows: number) =>
	new Lines((width) => {
		const wrapped = wrapTextWithAnsi(text, Math.max(1, width - 2));
		const shown =
			wrapped.length > rows
				? [...wrapped.slice(0, rows - 1), truncateToWidth(`${wrapped[rows - 1]} …`, Math.max(1, width - 2), "…")]
				: wrapped;
		return shown.map((line) => ` ${line}`);
	});

export class PluginsView implements PluginsUi, Component, Focusable {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private content: Component;
	private inputHandler: InputHandler | undefined;
	private inputTarget: Focusable | undefined;
	private _focused = false;
	// The list's state, kept between screens so the user comes back where they left.
	private tab: PluginsTab = "plugins";
	private readonly selected = new Map<PluginsTab, string>();
	private readonly collapsed = new Set<string>();
	/** Groups shown before: only a new group starts collapsed, so a rebuild keeps what the user opened. */
	private readonly seen = new Set<string>();
	private readonly opened = new Set<string>();
	private readonly search = new Input();
	private searching = false;

	constructor(tui: TUI, theme: Theme, keybindings: KeybindingsManager) {
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.content = frame(theme, "Plugins", [new Text(theme.fg("muted", "Loading…"), 1, 1)]);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		if (this.inputTarget) this.inputTarget.focused = value;
	}

	get capturesViewportInput(): boolean {
		return this.inputHandler?.capturesViewportInput === true;
	}

	private show(content: Component, inputHandler?: InputHandler, inputTarget?: Focusable): void {
		if (this.inputTarget) this.inputTarget.focused = false;
		this.content = content;
		this.inputHandler = inputHandler;
		this.inputTarget = inputTarget;
		if (inputTarget) inputTarget.focused = this._focused;
		this.tui.requestRender();
	}

	menu(menu: PluginMenu): Promise<string | undefined> {
		return new Promise((resolve) => {
			const list = new SelectList(
				menu.items,
				Math.max(1, Math.min(menu.items.length, MAX_VISIBLE_ITEMS)),
				getSelectListTheme(),
			);
			list.onSelect = (item) => resolve(item.value);
			list.onCancel = () => resolve(undefined);
			const body: Component[] = [
				...(menu.details ?? []).map((line) => capped(this.theme.fg("muted", line), 3)),
				new Spacer(1),
				list,
			];
			const footer = `${keyHint("tui.select.confirm", menu.confirmLabel)} • ${keyHint("tui.select.cancel", menu.cancelLabel)}`;
			this.show(
				frame(this.theme, menu.title, body, footer),
				listInput((data) => list.handleInput(data)),
			);
		});
	}

	input(title: string, placeholder: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			const field = new Input();
			const footer = `${keyHint("tui.select.confirm", "confirm")} • ${keyHint("tui.select.cancel", "cancel")}`;
			this.show(
				frame(this.theme, title, [new Text(this.theme.fg("muted", placeholder), 1, 0), field], footer),
				{
					handleInput: (data) => {
						if (this.keybindings.matches(data, "tui.select.confirm")) resolve(field.getValue().trim() || undefined);
						else if (this.keybindings.matches(data, "tui.select.cancel")) resolve(undefined);
						else {
							field.handleInput(data);
							this.tui.requestRender();
						}
					},
				},
				field,
			);
		});
	}

	status(title: string, message: string): void {
		this.show(frame(this.theme, title, [new Text(this.theme.fg("muted", message), 1, 1)]));
	}

	mcpUi(): McpUi {
		const view = new McpManagerView(this.tui, this.theme, this.keybindings);
		// Its own screens decide whether they take the viewport keys.
		this.show(view, view, view);
		return view;
	}

	browse(build: () => BrowseTab[], options: BrowseOptions = {}): Promise<BrowseAction | undefined> {
		return new Promise((resolve) => {
			const rebuild = () => {
				const built = build();
				for (const group of built.flatMap((tab) => tab.groups)) {
					if (this.seen.has(group.key)) continue;
					this.seen.add(group.key);
					if (group.collapsed) this.collapsed.add(group.key);
				}
				return built;
			};
			let tabs = rebuild();
			const { focus } = options;
			if (focus) {
				this.tab = focus.tab;
				if (focus.key) {
					this.selected.set(focus.tab, focus.key);
					const owner = tabs
						.find((tab) => tab.id === focus.tab)
						?.groups.find((group) => group.rows.some((row) => row.key === focus.key));
					if (owner) this.collapsed.delete(owner.key);
				}
			}
			let unsubscribe: (() => void) | undefined;
			const render = () => {
				this.show(
					this.browseScreen(tabs, options.notice),
					listInput((data) => {
						const action = this.browseKey(tabs, data);
						if (action === undefined) {
							render();
							return;
						}
						unsubscribe?.();
						resolve(action === "close" ? undefined : action);
					}),
					this.searching ? this.search : undefined,
				);
			};
			unsubscribe = options.subscribe?.(() => {
				tabs = rebuild();
				render();
			});
			render();
		});
	}

	/** The visible groups and rows of `tab`: a search shows every matching row and opens every group. */
	private items(tab: BrowseTab): Item[] {
		const query = this.search.getValue().trim().toLowerCase();
		const hit = (text: string) => text.toLowerCase().includes(query);
		return tab.groups.flatMap((group): Item[] => {
			const rows =
				!query || hit(group.label)
					? group.rows
					: group.rows.filter((row) => hit(`${row.label} ${row.right ?? ""} ${row.description ?? ""}`));
			if (query && rows.length === 0) return [];
			const collapsed = !query && this.collapsed.has(group.key);
			return [
				{ kind: "group", group, count: rows.length, collapsed },
				...(collapsed ? [] : rows.map((row) => ({ kind: "row" as const, row, group }))),
			];
		});
	}

	private selectedIndex(tab: BrowseTab, items: Item[]): number {
		const index = items.findIndex((item) => itemKey(item) === this.selected.get(tab.id));
		if (index !== -1) return index;
		const firstRow = items.findIndex((item) => item.kind === "row");
		return firstRow === -1 ? 0 : firstRow;
	}

	/** Handles a key on the list: the action it picks, `close`, or undefined when only the screen changed. */
	private browseKey(tabs: BrowseTab[], data: string): BrowseAction | "close" | undefined {
		const keys = this.keybindings;
		const tab = tabs.find((candidate) => candidate.id === this.tab) ?? tabs[0]!;
		const items = this.items(tab);
		const index = this.selectedIndex(tab, items);
		const select = (next: number) => {
			const item = items[Math.max(0, Math.min(items.length - 1, next))];
			if (item) this.selected.set(tab.id, itemKey(item));
		};
		const next = keys.matches(data, "app.plugins.nextTab");
		if (next || keys.matches(data, "app.plugins.previousTab")) {
			const step = next ? 1 : tabs.length - 1;
			this.tab = tabs[(tabs.indexOf(tab) + step) % tabs.length]!.id;
			return undefined;
		}
		if (this.searching) {
			if (keys.matches(data, "tui.select.cancel")) {
				if (this.search.getValue()) this.search.setValue("");
				else this.searching = false;
			} else if (keys.matches(data, "tui.select.down") || keys.matches(data, "tui.select.confirm")) {
				this.searching = false;
				const firstRow = items.findIndex((item) => item.kind === "row");
				select(firstRow === -1 ? 0 : firstRow);
			} else if (keys.matches(data, "tui.select.up")) {
				this.searching = false;
			} else {
				this.search.handleInput(data);
			}
			return undefined;
		}
		const item = items[index];
		if (keys.matches(data, "tui.select.up")) select(index - 1);
		else if (keys.matches(data, "tui.select.down")) select(index + 1);
		else if (keys.matches(data, "tui.select.pageUp")) select(index - MAX_VISIBLE_ROWS);
		else if (keys.matches(data, "tui.select.pageDown")) select(index + MAX_VISIBLE_ROWS);
		else if (keys.matches(data, "tui.select.left") && item) {
			this.collapsed.add(item.group.key);
			this.selected.set(tab.id, item.group.key);
		} else if (keys.matches(data, "tui.select.right") && item) {
			this.collapsed.delete(item.group.key);
		} else if (keys.matches(data, "tui.select.cancel")) {
			return "close";
		} else if (keys.matches(data, "app.plugins.search")) {
			this.searching = true;
		} else {
			const key = ACTION_NAMES.find((name) => keys.matches(data, ACTION_KEYBINDINGS[name]));
			if (!key) return undefined;
			const own = item ? (item.kind === "row" ? item.row.actions : (item.group.actions ?? {})) : {};
			const target = item ? { target: itemKey(item) } : {};
			if (Object.hasOwn(own, key)) return { tab: tab.id, key, ...target };
			if (key === "enter" && item?.kind === "group") {
				if (item.collapsed) this.collapsed.delete(item.group.key);
				else this.collapsed.add(item.group.key);
			} else if (key === "enter" && item?.kind === "row") {
				if (this.opened.has(item.row.key)) this.opened.delete(item.row.key);
				else this.opened.add(item.row.key);
			} else if (Object.hasOwn(tab.actions, key)) {
				return { tab: tab.id, key, ...target };
			}
		}
		return undefined;
	}

	private browseScreen(tabs: BrowseTab[], notice: BrowseOptions["notice"]): Component {
		const { theme } = this;
		const tab = tabs.find((candidate) => candidate.id === this.tab) ?? tabs[0]!;
		const query = this.search.getValue().trim();
		const bar = tabs
			.map((candidate) => {
				const label = query
					? `${candidate.label} (${this.items(candidate).filter((item) => item.kind === "row").length})`
					: candidate.label;
				return candidate === tab ? theme.fg("accent", theme.bold(label)) : theme.fg("muted", label);
			})
			.join("   ");
		const items = this.items(tab);
		// The search covers every tab: point at the ones with matches.
		const elsewhere = tabs.filter(
			(candidate) => candidate !== tab && this.items(candidate).some((item) => item.kind === "row"),
		);
		const none = !query
			? tab.empty
			: elsewhere.length
				? `Nothing matches here; ${elsewhere.map((candidate) => candidate.label).join(" and ")} ${elsewhere.length === 1 ? "has" : "have"} matches (${keyText("app.plugins.nextTab")}).`
				: "Nothing matches.";
		const body: Component[] = [
			new Text(bar, 1, 0),
			this.searching || query
				? this.search
				: new Text(theme.fg("dim", `${keyText("app.plugins.search")} search`), 1, 0),
			new Spacer(1),
			items.length ? new Lines((width) => this.listLines(tab, items, width)) : new Text(theme.fg("muted", none), 1, 0),
		];
		if (notice) body.push(new Spacer(1), capped(theme.fg(notice.error ? "error" : "success", notice.text), 3));
		return frame(theme, "Plugins", body, this.browseFooter(tab, items));
	}

	/** One line: the label, a dim right text, and the badge at the right edge. */
	private line(prefix: string, label: string, right: string | undefined, badge: Badge | undefined, width: number) {
		const tag = badge ? this.theme.fg(badge.tone, `[${badge.text}]`) : "";
		const left = `${prefix}${oneLine(label)}${right ? `  ${this.theme.fg("dim", oneLine(right))}` : ""}`;
		const shown = truncateToWidth(left, Math.max(1, width - (tag ? visibleWidth(tag) + 2 : 0)));
		return tag ? `${shown}${" ".repeat(Math.max(2, width - visibleWidth(shown) - visibleWidth(tag)))}${tag}` : shown;
	}

	private listLines(tab: BrowseTab, items: Item[], width: number): string[] {
		const { theme } = this;
		const inner = Math.max(1, width - 2);
		const index = this.selectedIndex(tab, items);
		const start = Math.max(0, Math.min(index - Math.floor(MAX_VISIBLE_ROWS / 2), items.length - MAX_VISIBLE_ROWS));
		const lines: string[] = [];
		items.slice(start, start + MAX_VISIBLE_ROWS).forEach((item, offset) => {
			const selected = start + offset === index;
			const cursor = selected ? theme.fg("accent", "→ ") : "  ";
			if (item.kind === "group") {
				const head = theme.bold(`${item.collapsed ? "▸" : "▾"} ${item.group.label} (${item.count})`);
				const label = selected ? theme.fg("accent", head) : head;
				lines.push(` ${this.line(cursor, label, item.group.right, item.group.badge, inner)}`);
				return;
			}
			const { row } = item;
			const label = selected ? theme.fg("accent", row.label) : row.dimmed ? theme.fg("muted", row.label) : row.label;
			lines.push(` ${this.line(`  ${cursor}`, label, row.right, row.badge, inner)}`);
			const below = [
				...(row.description ? [theme.fg("dim", oneLine(row.description))] : []),
				...(this.opened.has(row.key) ? (row.details ?? []).map((detail) => theme.fg("muted", oneLine(detail))) : []),
			];
			for (const text of below) lines.push(` ${truncateToWidth(`      ${text}`, inner)}`);
		});
		if (items.length > MAX_VISIBLE_ROWS) lines.push(` ${theme.fg("muted", `  (${index + 1}/${items.length})`)}`);
		return lines;
	}

	private browseFooter(tab: BrowseTab, items: Item[]): string {
		if (this.searching) {
			return [
				rawKeyHint("type", "to filter"),
				keyHint("tui.select.confirm", "results"),
				keyHint("app.plugins.nextTab", "next tab"),
				keyHint("tui.select.cancel", "clear"),
			].join(" • ");
		}
		const item = items[this.selectedIndex(tab, items)];
		const own = item ? (item.kind === "row" ? item.row.actions : (item.group.actions ?? {})) : {};
		const opens =
			item?.kind === "group"
				? item.collapsed
					? "expand"
					: "collapse"
				: item?.kind === "row" && item.row.details?.length
					? "details"
					: undefined;
		// One hint per action, `enter/i install`, each shown as the keys it is bound to.
		const hints = (actions: [string, string][]) => {
			const shown = (key: string) => (Object.hasOwn(ACTION_KEYBINDINGS, key) ? actionKey(key as ActionName) : key);
			const byLabel = new Map<string, string[]>();
			for (const [key, label] of actions) byLabel.set(label, [...(byLabel.get(label) ?? []), shown(key)]);
			return [...byLabel].map(([label, keys]) => rawKeyHint(keys.join("/"), label));
		};
		// Two steady lines: what the selected row offers, then the keys that work anywhere on the tab.
		const row = hints([
			...Object.entries(own),
			...(opens && !Object.hasOwn(own, "enter") ? ([["enter", opens]] as [string, string][]) : []),
		]);
		const anywhere = [
			...hints(Object.entries(tab.actions).filter(([key]) => !Object.hasOwn(own, key))),
			keyHint("app.plugins.search", "search"),
			keyHint("app.plugins.nextTab", "next tab"),
			keyHint("tui.select.cancel", "close"),
		];
		return [...(row.length ? [row.join(" • ")] : []), anywhere.join(" • ")].join("\n");
	}

	handleInput(data: string): void {
		this.inputHandler?.handleInput?.(data);
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

/** The session's MCP servers, from the MCP extension. */
export interface PluginsMcp {
	list(): McpServerSummary[];
	subscribe(listener: () => void): () => void;
	/** Runs `/mcp`'s menus for `names` on `ui` until the user leaves them; with one name, `action` runs first. */
	manage(names: readonly string[], ui: McpUi, action?: string): Promise<void>;
}

export interface ManagePluginsOptions {
	/** Reloads the session, which loads plugin skills and commands. */
	reload: () => Promise<void>;
	/** The session's MCP servers; absent with `--no-mcp`. */
	mcp?: PluginsMcp;
	/** Starts and stops plugin MCP servers for what is installed, trusted and enabled now. Returns problems. */
	applyMcp?: () => string[];
}

/** How long an install waits for its MCP servers to connect or ask for a sign-in. */
const MCP_WAIT_MS = 15_000;
/** Catalogs older than this are fetched again when `/plugins` opens, as Grok Build does. */
const CATALOG_TTL_MS = 5 * 60 * 1000;

interface Snapshot {
	installed: PluginView[];
	importable: ImportablePlugin[];
	markets: MarketplaceListing[];
}

/** Catalog fetches running in the background, and the ones that failed. */
interface Fetches {
	busy: Set<string>;
	failed: Map<string, string>;
	offline: boolean;
}

function isLocal(source: string): boolean {
	const parsed = parseSource(source, homedir());
	return !("error" in parsed) && parsed.kind === "local";
}

interface Outcome {
	focus?: BrowseOptions["focus"];
	notice?: BrowseOptions["notice"];
}

/** The names a plugin's MCP servers register under. */
function serverNames(plugin: PluginView): string[] {
	return Object.keys(plugin.inventory.mcpServers).map((server) => pluginServerName(plugin.namespace, server));
}

/** What a plugin's running servers are doing, for its row. */
function mcpState(servers: McpServerSummary[]): { text: string; badge?: Badge } | undefined {
	if (servers.length === 0) return undefined;
	const any = (state: McpServerSummary["state"]) => servers.some((server) => server.state === state);
	if (any("needs-auth")) return { text: "MCP needs sign-in", badge: { text: "needs sign-in", tone: "warning" } };
	if (any("failed")) return { text: "MCP failed", badge: { text: "MCP failed", tone: "error" } };
	if (any("starting") || any("connecting")) return { text: "MCP connecting…" };
	if (servers.every((server) => server.state === "connected")) {
		return {
			text: `MCP connected, ${plural(
				servers.reduce((sum, server) => sum + server.tools, 0),
				"tool",
			)}`,
		};
	}
	return { text: "MCP off" };
}

function pluginRow(plugin: PluginView, running: McpServerSummary[]): BrowseRow {
	const { inventory } = plugin;
	const on = plugin.enabled && plugin.trusted;
	const names = serverNames(plugin);
	const mine = on ? running.filter((server) => names.includes(server.name)) : [];
	const mcp = mcpState(mine);
	const offers = [
		...(inventory.skills.length ? [plural(inventory.skills.length, "skill")] : []),
		...(inventory.commands.length ? [plural(inventory.commands.length, "command")] : []),
		...(names.length ? [plural(names.length, "MCP server")] : []),
	].join(", ");
	return {
		key: `plugin:${plugin.scopeKind}:${plugin.namespace}`,
		label: `${plugin.namespace}${inventory.version ? ` v${inventory.version}` : ""}`,
		...(plugin.marketplace ? { right: `@${plugin.marketplace}` } : {}),
		description: [offers, mcp?.text, inventory.description].filter(Boolean).join(" · "),
		details: [plugin.identity, ...describeInventory(inventory).slice(1)],
		...(!plugin.trusted
			? { badge: { text: "not trusted", tone: "warning" } }
			: !plugin.enabled
				? { badge: { text: "disabled", tone: "error" } }
				: mcp?.badge
					? { badge: mcp.badge }
					: {}),
		dimmed: !on,
		actions: {
			...(mine.some((server) => server.state === "needs-auth") ? { enter: "sign in" } : {}),
			space: on ? "disable" : plugin.trusted ? "enable" : "trust and enable",
			...(mine.length ? { m: "MCP servers" } : {}),
			u: "update",
			x: "uninstall",
		},
	};
}

function pluginsTab(data: Snapshot, running: McpServerSummary[]): BrowseTab {
	const installed = (scope: PluginView["scopeKind"]) =>
		data.installed.filter((plugin) => plugin.scopeKind === scope).map((plugin) => pluginRow(plugin, running));
	const imports = (from: ImportablePlugin["from"]) =>
		data.importable
			.filter((plugin) => plugin.from === from)
			.map((plugin): BrowseRow => ({
				key: `import:${plugin.source}`,
				label: plugin.name,
				right: `@${plugin.source.slice(plugin.source.indexOf("@") + 1)}`,
				description: `installed in ${plugin.from}${plugin.enabled ? "" : ", turned off there"}`,
				actions: { enter: "import", i: "import" },
			}));
	return {
		id: "plugins",
		label: "Installed",
		groups: [
			{ key: "user", label: "User", rows: installed("user") },
			{ key: "project", label: "This project", rows: installed("project") },
			{ key: "claude", label: "In Claude Code", rows: imports("Claude Code") },
			{ key: "grok", label: "In Grok Build", rows: imports("Grok Build") },
		].filter((group) => group.rows.length > 0),
		actions: { a: "install from source", r: "reload session" },
		empty: `No plugins installed. Press ${actionKey("a")} to install one from a source, or ${keyText("app.plugins.nextTab")} to the Marketplace.`,
	};
}

/** Every marketplace with every plugin, as Grok Build lists them; installing one adds its marketplace. */
function marketplaceTab(data: Snapshot, fetches: Fetches): BrowseTab {
	const elsewhere = new Map(data.importable.map((plugin) => [plugin.source, plugin.from]));
	const groups = data.markets.map((market): BrowseGroup => {
		const failure = fetches.failed.get(market.name);
		const badge: Badge | undefined = failure
			? { text: "fetch failed", tone: "error" }
			: market.missing
				? fetches.busy.has(market.name)
					? { text: "fetching…", tone: "muted" }
					: fetches.offline
						? { text: "offline", tone: "muted" }
						: undefined
				: market.plugins.length === 0 && market.diagnostics.length
					? { text: "unreadable", tone: "error" }
					: undefined;
		return {
			key: `market:${market.name}`,
			label: market.name,
			right: failure ?? market.from ?? market.source,
			...(badge ? { badge } : {}),
			actions: { u: "refresh", ...(market.added ? { x: "remove" } : {}) },
			// As Grok Build: the tab opens on the list of marketplaces, and enter opens one.
			collapsed: data.markets.length > 1,
			rows: market.plugins.map((entry): BrowseRow => {
				const source = `${entry.name}@${market.name}`;
				const from = elsewhere.get(source);
				const by = [entry.version ? `v${entry.version}` : "", entry.author ? `by ${entry.author}` : ""]
					.filter(Boolean)
					.join(" ");
				return {
					key: `entry:${source}`,
					label: entry.name,
					...(by ? { right: by } : {}),
					...(entry.description ? { description: entry.description } : {}),
					...(entry.update
						? { badge: { text: "update available", tone: "warning" } }
						: entry.installed
							? { badge: { text: "installed", tone: "success" } }
							: from
								? { badge: { text: `in ${from}`, tone: "accent" } }
								: {}),
					actions: entry.installed
						? { ...(entry.update ? { u: "update" } : {}), d: "uninstall" }
						: { enter: "install", i: "install" },
				};
			}),
		};
	});
	return {
		id: "marketplace",
		label: "Marketplace",
		groups,
		actions: { a: "add marketplace", r: "refresh all" },
		empty: `No marketplaces. Press ${actionKey("a")} to add one.`,
	};
}

/** Runs `/plugins` until the user leaves; offers a reload when something changed. */
export async function managePlugins(
	ui: PluginsUi,
	manager: PluginManager,
	options: ManagePluginsOptions,
): Promise<void> {
	const { mcp } = options;
	let changed = false;
	const confirm = async (title: string, details: string[], yes: string, no: string) =>
		(await ui.menu({
			title,
			details,
			items: [
				{ value: "yes", label: yes },
				{ value: "no", label: no },
			],
			confirmLabel: "choose",
			cancelLabel: no.toLowerCase(),
		})) === "yes";
	const confirmTrust: TrustConfirm = (summary, inventory) =>
		confirm(
			`Trust ${inventory.name}?`,
			["Trusting a plugin lets it run its MCP servers and use its skills and commands:", ...summary],
			"Trust and activate",
			"Do not trust",
		);
	const snapshot = (): Snapshot => ({
		installed: manager.list(),
		importable: manager.importablePlugins(),
		markets: manager.browseMarketplaces(),
	});
	let data = snapshot();
	const listeners = new Set<() => void>();
	/** Rebuilds the screen on MCP changes and when a catalog fetch lands. */
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		const off = mcp?.subscribe(listener);
		return () => {
			listeners.delete(listener);
			off?.();
		};
	};
	// `--offline` or `KNIGHTCODE_OFFLINE`: catalogs are fetched only from folders.
	const fetches: Fetches = { busy: new Set(), failed: new Map(), offline: isOfflineModeEnabled() };
	const fetchCatalog = async (market: MarketplaceListing) => {
		try {
			await manager.fetchListing(market);
			fetches.failed.delete(market.name);
		} catch (error) {
			fetches.failed.set(market.name, errorText(error));
		}
	};
	// Opening /plugins fetches the catalogs that are missing or a few minutes old, in the background, as Grok Build
	// does; each group fills in as its fetch lands.
	for (const market of data.markets) {
		const stale = market.missing || !market.updatedAt || Date.now() - Date.parse(market.updatedAt) > CATALOG_TTL_MS;
		if (!stale || (fetches.offline && !isLocal(market.source))) continue;
		fetches.busy.add(market.name);
		void fetchCatalog(market).finally(() => {
			fetches.busy.delete(market.name);
			try {
				data = snapshot();
			} catch {}
			for (const listener of listeners) listener();
		});
	}
	/** Starts and stops plugin MCP servers now; skills and commands load on reload. */
	const applyMcp = (): string[] => {
		changed = true;
		return options.applyMcp?.() ?? [];
	};
	const rowKey = (plugin: PluginView) => `plugin:${plugin.scopeKind}:${plugin.namespace}`;
	const reloadHint = "Skills and commands load when you reload (r).";

	/** Resolves once the servers connected, failed or asked for a sign-in, or the wait ran out. */
	const settle = (names: string[]) =>
		new Promise<McpServerSummary[]>((resolve) => {
			if (!mcp) return resolve([]);
			const mine = () => mcp.list().filter((server) => names.includes(server.name));
			let unsubscribe = () => {};
			const finish = () => {
				clearTimeout(timer);
				unsubscribe();
				resolve(mine());
			};
			const timer = setTimeout(finish, MCP_WAIT_MS);
			const check = () => {
				const states = mine();
				const busy = states.some((server) => server.state === "starting" || server.state === "connecting");
				if (states.length === names.length && !busy) finish();
			};
			unsubscribe = mcp.subscribe(check);
			check();
		});

	/** A plugin turned on: start its MCP servers, and open `/mcp` for those that ask for a sign-in. */
	const activated = async (plugin: PluginView, done: string): Promise<Outcome> => {
		const focus = { tab: "plugins" as const, key: rowKey(plugin) };
		const problems = applyMcp();
		if (problems.length) return { focus, notice: { text: [done, ...problems].join(" "), error: true } };
		const names = serverNames(plugin);
		if (mcp && names.length) {
			ui.status(`Starting ${plugin.name}`, "Connecting its MCP servers…");
			const asking = (await settle(names)).filter((server) => server.state === "needs-auth");
			if (asking.length)
				await mcp.manage(
					asking.map((server) => server.name),
					ui.mcpUi(),
				);
		}
		return { focus, notice: { text: `${done} ${reloadHint}` } };
	};

	const install = async (source: string): Promise<Outcome> => {
		ui.status(`Installing ${source}`, "Fetching and checking the plugin…");
		const { plugin, trusted } = await manager.install(source, { confirm: confirmTrust });
		changed = true;
		if (trusted) return activated(plugin, `Installed ${plugin.name}.`);
		return {
			focus: { tab: "plugins", key: rowKey(plugin) },
			notice: {
				text: `Installed ${plugin.name}. It runs nothing until you trust it: ${keyText("app.plugins.toggle")}.`,
			},
		};
	};

	const uninstall = async (plugin: PluginView): Promise<Outcome | undefined> => {
		if (!(await confirm(`Uninstall ${plugin.name}?`, ["Its data directory is kept."], "Uninstall", "Keep it"))) {
			return undefined;
		}
		await manager.uninstall(plugin.namespace, { scope: plugin.scopeKind });
		const problems = applyMcp();
		return { notice: { text: [`Uninstalled ${plugin.name}.`, ...problems].join(" "), error: problems.length > 0 } };
	};

	const update = async (plugin: PluginView): Promise<Outcome> => {
		ui.status(`Updating ${plugin.name}`, "Fetching its source…");
		const result = await manager.update(plugin.namespace, { scope: plugin.scopeKind });
		if (result.changed) applyMcp();
		return {
			focus: { tab: "plugins", key: rowKey(plugin) },
			notice: { text: result.changed ? `Updated ${plugin.name}. ${reloadHint}` : `${plugin.name} is up to date.` },
		};
	};

	const addMarketplace = async (source: string, ref?: string): Promise<Outcome> => {
		ui.status(`Adding ${source}`, "Fetching its catalog…");
		const added = await manager.addMarketplace(source, ref ? { ref } : {});
		return {
			focus: { tab: "marketplace", key: `market:${added.name}` },
			notice: { text: `Added ${added.name} with ${plural(added.plugins.length, "plugin")}. Nothing is installed.` },
		};
	};

	const perform = async (
		{ tab, key, target }: BrowseAction,
		data: Snapshot,
	): Promise<Outcome | "reload" | undefined> => {
		if (tab === "plugins" && key === "r") return "reload";
		if (tab === "plugins" && key === "a") {
			const source = await ui.input("Install a plugin", "owner/repo, a Git URL, a folder, or name@marketplace");
			return source ? install(source) : undefined;
		}
		if (tab === "marketplace" && key === "a") {
			const source = await ui.input("Add a marketplace", "owner/repo, a Git URL, or a folder");
			return source ? addMarketplace(source) : undefined;
		}
		if (tab === "marketplace" && key === "r") {
			const markets = data.markets.filter((market) => !fetches.offline || isLocal(market.source));
			ui.status("Refreshing marketplaces", `Fetching ${plural(markets.length, "catalog")}…`);
			await Promise.all(markets.map(fetchCatalog));
			const failed = markets.filter((market) => fetches.failed.has(market.name)).length;
			return {
				notice: {
					text: `Refreshed ${plural(markets.length - failed, "marketplace")}.${failed ? ` ${failed} failed.` : ""}`,
					error: failed > 0,
				},
			};
		}
		if (target?.startsWith("import:")) return install(target.slice("import:".length));
		if (target?.startsWith("entry:")) {
			const source = target.slice("entry:".length);
			const installed = data.installed.find((candidate) => candidate.source === source);
			if (!installed) return install(source);
			if (key === "d") return uninstall(installed);
			// The user stays on the catalog row they updated.
			if (key === "u") return { ...(await update(installed)), focus: { tab, key: target } };
			return undefined;
		}
		const market = data.markets.find((candidate) => `market:${candidate.name}` === target);
		if (market && key === "u") {
			ui.status(`Refreshing ${market.name}`, "Fetching its catalog…");
			await fetchCatalog(market);
			const failure = fetches.failed.get(market.name);
			return {
				focus: { tab, key: `market:${market.name}` },
				notice: failure ? { text: failure, error: true } : { text: `Refreshed ${market.name}.` },
			};
		}
		if (market?.added && key === "x") {
			await manager.removeMarketplace(market.name, { scope: market.scope ?? "user" });
			return { notice: { text: `Removed ${market.name}. Plugins installed from it stay installed.` } };
		}
		const plugin = data.installed.find((candidate) => rowKey(candidate) === target);
		if (!plugin) return undefined;
		const focus = { tab: "plugins" as const, key: rowKey(plugin) };
		switch (key) {
			case "space": {
				const enable = !(plugin.enabled && plugin.trusted);
				const result = await manager.setEnabled(plugin.namespace, enable, {
					scope: plugin.scopeKind,
					confirm: confirmTrust,
				});
				if (enable && !result.trusted)
					return { focus, notice: { text: `${plugin.name} is not trusted and stays off.` } };
				if (enable) return activated(result.plugin, `Enabled ${plugin.name}.`);
				const problems = applyMcp();
				return {
					focus,
					notice: { text: [`Disabled ${plugin.name}.`, ...problems].join(" "), error: problems.length > 0 },
				};
			}
			case "enter":
			case "m": {
				const names = serverNames(plugin);
				const running = mcp?.list().filter((server) => names.includes(server.name)) ?? [];
				// Enter is offered only while a server needs a sign-in: it starts each one's sign-in in turn (`manage` runs
				// a first action only for a single server).
				const asking = running.filter((server) => server.state === "needs-auth");
				if (mcp && key === "enter" && asking.length) {
					for (const server of asking) await mcp.manage([server.name], ui.mcpUi(), "signin");
				} else if (mcp && running.length) {
					await mcp.manage(
						running.map((server) => server.name),
						ui.mcpUi(),
					);
				}
				return { focus };
			}
			case "u":
				return update(plugin);
			case "x":
				return uninstall(plugin);
		}
		return undefined;
	};

	let outcome: Outcome = {};
	for (;;) {
		const action = await ui.browse(() => [pluginsTab(data, mcp?.list() ?? []), marketplaceTab(data, fetches)], {
			subscribe,
			...outcome,
		});
		if (!action) break;
		try {
			const result = await perform(action, data);
			if (result === "reload") {
				await options.reload();
				return;
			}
			outcome = result ?? {};
		} catch (error) {
			outcome = { notice: { text: errorText(error), error: true } };
		}
		data = snapshot();
	}
	if (!changed) return;
	const reload = await ui.menu({
		title: "Apply plugin changes?",
		details: ["Skills and commands of plugins you changed load in new and reloaded sessions."],
		items: [
			{ value: "reload", label: "Reload this session now" },
			{ value: "later", label: "Later" },
		],
		confirmLabel: "choose",
		cancelLabel: "later",
	});
	if (reload === "reload") await options.reload();
}
