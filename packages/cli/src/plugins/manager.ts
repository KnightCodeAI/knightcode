/**
 * Installs, updates and removes plugins, and tells sessions which ones are active. The CLI, the TUI and the app
 * server all go through this class.
 *
 * A plugin is active only when three things exist: a declaration in settings (what the user wants), an install
 * record in `state.json` for that identity and scope (which revision), and the revision directory (the content); and
 * when the plugin is trusted and enabled. Mutations write in that order backwards - revision, record, declaration -
 * and uninstall removes the declaration first, so a failure at any step leaves either the previous state or an
 * inactive orphan that no session loads.
 */

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import { type PluginDeclaration, SettingsManager } from "../core/settings-manager.ts";
import { ProjectTrustStore } from "../core/trust-manager.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import { fetchCommit, resolveRemoteCommit } from "./git.ts";
import {
	type ForeignPlugin,
	foreignPlugins,
	type KnownMarketplace,
	knownMarketplaces,
	marketplaceKey,
} from "./known.ts";
import { loadPlugin, resolveInsideRoot, sanitizePluginName } from "./manifest.ts";
import { type MarketplaceCatalog, type MarketplaceEntry, readMarketplace } from "./marketplace.ts";
import { describeMcpServer, mcpEnvironmentNames } from "./mcp.ts";
import { type PluginInventory, renderPlugin } from "./render.ts";
import { canonicalUrlFor, parseSource, pluginIdentity } from "./sources.ts";
import { copyContent, hashTree, type InstallRecord, type MarketplaceRecord, PluginStore, sha256 } from "./store.ts";

export type PluginScope = "user" | "project";

export interface PluginManagerOptions {
	agentDir?: string;
	cwd: string;
	/** Deadline for each network Git operation. */
	gitTimeoutMs?: number;
	/** Test seam, called after each step of a mutation. */
	failpoint?: (step: "revision" | "record" | "declaration") => void;
}

export interface PluginView extends InstallRecord {
	scopeKind: PluginScope;
	root: string;
	dataDir: string;
	enabled: boolean;
	trusted: boolean;
	inventory: PluginInventory;
}

export interface ActivePlugin {
	identity: string;
	name: string;
	namespace: string;
	scope: PluginScope;
	commit: string;
	revision: string;
	root: string;
	dataDir: string;
	inventory: PluginInventory;
}

export interface MarketplaceView {
	name: string;
	/** Where it is declared: the user's settings, or else the current project's. */
	scope: PluginScope;
	source: string;
	ref?: string;
	description?: string;
	commit: string;
	updatedAt: string;
	plugins: Array<{ name: string; description?: string; version?: string; installed: boolean }>;
	diagnostics: string[];
}

/** A plugin Claude Code or Grok Build installed that is not installed here; `source` installs it. */
export interface ImportablePlugin {
	name: string;
	from: ForeignPlugin["from"];
	source: string;
	/** False when that tool has it turned off. */
	enabled: boolean;
}

/** Asked before a plugin is trusted, with the lines of `describeInventory()`. */
export type TrustConfirm = (summary: string[], inventory: PluginInventory) => Promise<boolean>;

interface Declaration {
	source: string;
	ref?: string;
	path?: string;
}

interface Target extends Declaration {
	identity: string;
	marketplace?: string;
	entry?: MarketplaceEntry;
	origin: { kind: "local"; dir: string } | { kind: "git"; url: string; ref?: string };
	subdir?: string;
}

/** Catalog entry fields that change what the plugin contains; they are part of its revision. */
const ENTRY_COMPONENT_FIELDS = ["skills", "commands", "mcpServers", "strict", "agents", "hooks", "lspServers"];

/** What a plugin will run and offer, for the trust confirmation, `details` and `update`. */
export function describeInventory(inventory: PluginInventory): string[] {
	const lines = [
		`${inventory.name}${inventory.version ? ` ${inventory.version}` : ""}${inventory.description ? ` - ${inventory.description}` : ""}`,
	];
	if (inventory.skills.length) lines.push(`Skills: ${inventory.skills.map((skill) => skill.name).join(", ")}`);
	if (inventory.commands.length) {
		lines.push(
			`Commands: ${inventory.commands.map((command) => `/${inventory.namespace}:${command.name}`).join(", ")}`,
		);
	}
	for (const [name, config] of Object.entries(inventory.mcpServers)) {
		lines.push(`MCP server ${name}: ${describeMcpServer(config)}`);
	}
	const env = mcpEnvironmentNames(inventory.mcpServers);
	if (env.length) lines.push(`MCP configuration reads environment variables: ${env.join(", ")}`);
	if (inventory.unsupported.length) lines.push(`Not supported, never run: ${inventory.unsupported.join(", ")}`);
	for (const warning of inventory.warnings) lines.push(`Warning: ${warning}`);
	return lines;
}

function installCommand(declaration: Declaration, project: boolean): string {
	return [
		"knightcode plugin install",
		declaration.source,
		...(declaration.ref ? ["--ref", declaration.ref] : []),
		...(declaration.path ? ["--path", declaration.path] : []),
		...(project ? ["-l"] : []),
	].join(" ");
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class PluginManager {
	readonly store: PluginStore;
	private readonly agentDir: string;
	private readonly cwd: string;
	private readonly gitTimeoutMs: number | undefined;
	private readonly failpoint: PluginManagerOptions["failpoint"];

	constructor(options: PluginManagerOptions) {
		this.agentDir = options.agentDir ?? getAgentDir();
		this.cwd = resolvePath(options.cwd);
		this.store = new PluginStore(this.agentDir);
		this.gitTimeoutMs = options.gitTimeoutMs;
		this.failpoint = options.failpoint;
	}

	/** The scope key of the current project. */
	get projectKey(): string {
		return canonicalizePath(this.cwd);
	}

	private get git() {
		mkdirSync(this.store.dir, { recursive: true });
		return { cwd: this.store.dir, timeoutMs: this.gitTimeoutMs };
	}

	/** The record scope for `scope`. Project scope needs a project the user trusted. */
	private scopeKey(scope: PluginScope): string {
		if (scope === "user") return "user";
		if (new ProjectTrustStore(this.agentDir).get(this.cwd) !== true) {
			throw new Error(`project ${this.cwd} is not trusted; start knightcode there and trust it first`);
		}
		return this.projectKey;
	}

	private readState() {
		try {
			return this.store.read();
		} catch (error) {
			throw new Error(`cannot read ${this.store.statePath}: ${errorText(error)}`);
		}
	}

	/** A fresh settings manager for writing `scope`, refusing settings that failed to load. */
	private openSettings(scope: PluginScope): SettingsManager {
		const settings = SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: scope === "project" });
		const errors = settings.drainErrors();
		if (errors.length > 0) {
			throw new Error(`cannot update settings: ${errors.map((entry) => entry.error.message).join("; ")}`);
		}
		return settings;
	}

	private async saveSettings(settings: SettingsManager, update: () => void): Promise<void> {
		update();
		await settings.flush();
		const errors = settings.drainErrors();
		if (errors.length > 0) {
			throw new Error(`cannot update settings: ${errors.map((entry) => entry.error.message).join("; ")}`);
		}
	}

	private declarations(settings: SettingsManager, scope: PluginScope): PluginDeclaration[] {
		return [...((scope === "user" ? settings.getGlobalSettings() : settings.getProjectSettings()).plugins ?? [])];
	}

	private catalog(record: MarketplaceRecord): MarketplaceCatalog {
		return readMarketplace(this.store.marketplaceRoot(record.id, record.revision));
	}

	/** Where `declaration` points and what its identity is. Uses only local state. */
	private resolveTarget(declaration: Declaration, baseDir: string, state = this.readState()): Target {
		const parsed = parseSource(declaration.source, baseDir);
		if ("error" in parsed) throw new Error(parsed.error);
		if (parsed.kind === "local") {
			return {
				...declaration,
				source: parsed.dir,
				identity: pluginIdentity(parsed.canonical, declaration.path),
				origin: { kind: "local", dir: parsed.dir },
				subdir: declaration.path,
			};
		}
		if (parsed.kind === "git") {
			return {
				...declaration,
				identity: pluginIdentity(parsed.canonical, declaration.path),
				origin: { kind: "git", url: parsed.url, ref: declaration.ref ?? parsed.ref },
				subdir: declaration.path,
			};
		}
		const market = state.marketplaces.find((record) => record.name === parsed.marketplace);
		if (!market) {
			throw new Error(`no marketplace named "${parsed.marketplace}"; add it with knightcode plugin marketplace add`);
		}
		const entry = this.catalog(market).plugins.find((candidate) => candidate.name === parsed.plugin);
		if (!entry) throw new Error(`marketplace "${market.name}" has no plugin named "${parsed.plugin}"`);
		const catalogEntry = `${entry.name}@${market.name}`;
		const base = { ...declaration, marketplace: market.name, entry };
		if (entry.source.kind === "local") {
			const subdir = [entry.source.path, declaration.path].filter(Boolean).join("/");
			return {
				...base,
				identity: pluginIdentity(market.canonical, subdir, catalogEntry),
				origin: { kind: "local", dir: this.store.marketplaceRoot(market.id, market.revision) },
				subdir,
			};
		}
		return {
			...base,
			identity: pluginIdentity(canonicalUrlFor(entry.source.url), entry.source.path, catalogEntry),
			origin: { kind: "git", url: entry.source.url, ref: declaration.ref ?? entry.source.sha ?? entry.source.ref },
			subdir: entry.source.path,
		};
	}

	/** The identity a declaration names, or undefined when it cannot be known offline. */
	private declarationIdentity(declaration: Declaration, baseDir: string, state: ReturnType<PluginStore["read"]>) {
		const known = state.plugins.find(
			(record) => record.marketplace && record.source === declaration.source && record.path === declaration.path,
		);
		if (known) return known.identity;
		try {
			return this.resolveTarget(declaration, baseDir, state).identity;
		} catch {
			return undefined;
		}
	}

	/** Downloads (or copies) and renders `target` into a staging directory. The caller removes `tmp`. */
	private async stage(target: Target) {
		const tmp = this.store.tempDir();
		try {
			let tree: string;
			let commit: string | undefined;
			if (target.origin.kind === "local") {
				tree = target.origin.dir;
			} else {
				commit = await resolveRemoteCommit(target.origin.url, target.origin.ref, this.git);
				tree = join(tmp, "src");
				await fetchCommit(target.origin.url, commit, tree, this.git);
			}
			const pluginDir = target.subdir ? resolveInsideRoot(tree, target.subdir) : tree;
			if (typeof pluginDir !== "string") throw new Error(pluginDir.error);
			if (!existsSync(pluginDir) || !statSync(pluginDir).isDirectory()) {
				throw new Error(`${target.subdir ? `"${target.subdir}" in ` : ""}${target.source} is not a directory`);
			}
			const stage = join(tmp, "revision");
			copyContent(pluginDir, join(stage, "plugin"));
			commit ??= hashTree(join(stage, "plugin"));
			const entryFields = Object.fromEntries(
				ENTRY_COMPONENT_FIELDS.filter((field) => target.entry?.raw[field] !== undefined).map((field) => [
					field,
					target.entry?.raw[field],
				]),
			);
			const revision = sha256(`${commit}\0${JSON.stringify(entryFields)}`).slice(0, 16);
			const plugin = loadPlugin(join(stage, "plugin"), target.entry);
			const id = `${plugin.namespace}-${sha256(target.identity).slice(0, 10)}`;
			const inventory = renderPlugin(plugin, {
				root: this.store.pluginRoot(id, revision),
				dataDir: this.store.dataDir(id),
			});
			writeFileSync(join(stage, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
			return { tmp, stage, commit, revision, id, inventory };
		} catch (error) {
			rmSync(tmp, { recursive: true, force: true });
			throw error;
		}
	}

	/** Records visible here: the user's and the current project's. */
	private visibleRecords(state = this.readState()): InstallRecord[] {
		return state.plugins.filter((record) => record.scope === "user" || record.scope === this.projectKey);
	}

	private assertNamespaceFree(namespace: string, identity: string, state: ReturnType<PluginStore["read"]>): void {
		const other = this.visibleRecords(state).find(
			(record) => record.namespace === namespace && record.identity !== identity,
		);
		if (other) {
			throw new Error(`plugin namespace "${namespace}" is already used by ${other.identity}; uninstall it first`);
		}
	}

	/** The record a management command names: plugin name, `name@marketplace`, or identity. */
	resolveRecord(name: string, scope: PluginScope = "user"): InstallRecord {
		const key = scope === "user" ? "user" : this.projectKey;
		const candidates = this.readState().plugins.filter(
			(record) =>
				record.scope === key &&
				[record.namespace, record.name, record.identity, `${record.name}@${record.marketplace}`].includes(name),
		);
		if (candidates.length === 0) throw new Error(`no installed plugin "${name}" in ${scope} scope`);
		if (candidates.length > 1) {
			throw new Error(
				`"${name}" names several plugins; use one of:\n${candidates.map((record) => `  ${record.identity}`).join("\n")}`,
			);
		}
		return candidates[0]!;
	}

	private view(record: InstallRecord, state: ReturnType<PluginStore["read"]>, settings?: SettingsManager): PluginView {
		const scopeKind: PluginScope = record.scope === "user" ? "user" : "project";
		let enabled = false;
		try {
			const source =
				settings ?? SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: scopeKind === "project" });
			const baseDir = scopeKind === "user" ? this.agentDir : this.cwd;
			const declaration = this.declarations(source, scopeKind).find(
				(candidate) => this.declarationIdentity(candidate, baseDir, state) === record.identity,
			);
			enabled = declaration !== undefined && declaration.enabled !== false;
		} catch {}
		return {
			...record,
			scopeKind,
			root: this.store.pluginRoot(record.id, record.revision),
			dataDir: this.store.dataDir(record.id),
			enabled,
			trusted: state.trusted.includes(record.identity),
			inventory: this.store.readInventory(record.id, record.revision) ?? {
				name: record.name,
				namespace: record.namespace,
				skills: [],
				commands: [],
				mcpServers: {},
				unsupported: [],
				warnings: ["the revision directory is missing; run knightcode plugin update"],
			},
		};
	}

	/** Installed plugins of the user and the current project. */
	list(): PluginView[] {
		let state: ReturnType<PluginStore["read"]>;
		try {
			state = this.readState();
		} catch {
			return [];
		}
		// One settings read per scope, not per plugin.
		const settings = new Map<PluginScope, SettingsManager>();
		const settingsFor = (scope: PluginScope) => {
			let manager = settings.get(scope);
			if (!manager) {
				manager = SettingsManager.create(this.cwd, this.agentDir, { projectTrusted: scope === "project" });
				settings.set(scope, manager);
			}
			return manager;
		};
		return this.visibleRecords(state).map((record) =>
			this.view(record, state, settingsFor(record.scope === "user" ? "user" : "project")),
		);
	}

	details(name: string, scope?: PluginScope): PluginView {
		const record = this.resolveRecord(name, scope);
		return this.view(record, this.readState());
	}

	async install(
		source: string,
		options: { scope?: PluginScope; ref?: string; path?: string; trust?: boolean; confirm?: TrustConfirm },
	): Promise<{ plugin: PluginView; trusted: boolean }> {
		const scope = options.scope ?? "user";
		this.scopeKey(scope);
		this.openSettings(scope);
		// A built-in marketplace, or one Claude Code or Grok Build has, is added by the first install from it. A removed
		// marketplace's catalog stays cached for the plugins installed from it, but installs nothing new.
		const parsed = parseSource(source, this.cwd);
		if (!("error" in parsed) && parsed.kind === "marketplace" && !this.declaredMarketplaces().has(parsed.marketplace)) {
			const known = this.availableMarketplaces().find((market) => market.name === parsed.marketplace);
			if (!known) {
				throw new Error(
					`marketplace "${parsed.marketplace}" is not added; add it with knightcode plugin marketplace add <source>`,
				);
			}
			const market = await this.addMarketplace(known.source, { scope, ...(known.ref ? { ref: known.ref } : {}) });
			source = `${parsed.plugin}@${market.name}`;
		}
		const target = this.resolveTarget(
			{
				source,
				...(options.ref ? { ref: options.ref } : {}),
				...(options.path ? { path: options.path } : {}),
			},
			this.cwd,
		);
		const staged = await this.stage(target);
		try {
			const before = this.readState();
			this.assertNamespaceFree(staged.inventory.namespace, target.identity, before);
			let trusted = options.trust === true || before.trusted.includes(target.identity);
			if (!trusted && options.confirm) {
				trusted = await options.confirm(describeInventory(staged.inventory), staged.inventory);
			}
			const declaration: PluginDeclaration = {
				source:
					target.origin.kind === "local" && !target.marketplace
						? this.declaredLocalSource(target.source, scope)
						: source,
				...(options.ref ? { ref: options.ref } : {}),
				...(options.path ? { path: options.path } : {}),
			};
			const record = await this.store.withLock(async () => {
				const settings = this.openSettings(scope);
				const state = this.readState();
				this.assertNamespaceFree(staged.inventory.namespace, target.identity, state);
				this.store.commitRevision(staged.stage, this.store.revisionDir(staged.id, staged.revision));
				mkdirSync(this.store.dataDir(staged.id), { recursive: true });
				this.failpoint?.("revision");
				const scopeKey = this.scopeKey(scope);
				const record: InstallRecord = {
					identity: target.identity,
					id: staged.id,
					scope: scopeKey,
					name: staged.inventory.name,
					namespace: staged.inventory.namespace,
					...(target.marketplace ? { marketplace: target.marketplace } : {}),
					source: declaration.source,
					...(declaration.ref ? { ref: declaration.ref } : {}),
					...(declaration.path ? { path: declaration.path } : {}),
					commit: staged.commit,
					revision: staged.revision,
					installedAt: new Date().toISOString(),
				};
				state.plugins = [
					...state.plugins.filter((other) => !(other.identity === record.identity && other.scope === scopeKey)),
					record,
				];
				if (trusted && !state.trusted.includes(record.identity)) state.trusted.push(record.identity);
				this.store.write(state);
				this.failpoint?.("record");
				const baseDir = scope === "user" ? this.agentDir : this.cwd;
				const declarations = this.declarations(settings, scope);
				const index = declarations.findIndex(
					(candidate) => this.declarationIdentity(candidate, baseDir, state) === record.identity,
				);
				if (index === -1) declarations.push(declaration);
				else
					declarations[index] = {
						...declaration,
						...(declarations[index]!.enabled === false ? { enabled: false } : {}),
					};
				await this.saveSettings(settings, () =>
					scope === "user" ? settings.setPlugins(declarations) : settings.setProjectPlugins(declarations),
				);
				this.failpoint?.("declaration");
				return record;
			});
			return { plugin: this.view(record, this.readState()), trusted };
		} finally {
			rmSync(staged.tmp, { recursive: true, force: true });
		}
	}

	/** A local source as the declaration stores it: absolute for the user, relative to the project when inside it. */
	private declaredLocalSource(dir: string, scope: PluginScope): string {
		if (scope === "user") return dir;
		const rel = join(dir).startsWith(join(this.cwd))
			? `./${join(dir)
					.slice(join(this.cwd).length + 1)
					.replace(/\\/g, "/")}`
			: dir;
		return rel === "./" ? "." : rel;
	}

	/** Fetches the declaration's source again and moves the scope's record to the new revision. */
	async update(name: string, options: { scope?: PluginScope }): Promise<{ plugin: PluginView; changed: boolean }> {
		const scope = options.scope ?? "user";
		const record = this.resolveRecord(name, scope);
		const baseDir = scope === "user" ? this.agentDir : this.cwd;
		const target = this.resolveTarget({ source: record.source, ref: record.ref, path: record.path }, baseDir);
		const staged = await this.stage(target);
		try {
			if (staged.revision === record.revision && staged.id === record.id) {
				return { plugin: this.view(record, this.readState()), changed: false };
			}
			const updated = await this.store.withLock(async () => {
				const state = this.readState();
				this.store.commitRevision(staged.stage, this.store.revisionDir(staged.id, staged.revision));
				mkdirSync(this.store.dataDir(staged.id), { recursive: true });
				const next: InstallRecord = {
					...record,
					id: staged.id,
					name: staged.inventory.name,
					namespace: staged.inventory.namespace,
					commit: staged.commit,
					revision: staged.revision,
					installedAt: new Date().toISOString(),
				};
				state.plugins = state.plugins.map((other) =>
					other.identity === record.identity && other.scope === record.scope ? next : other,
				);
				this.store.write(state);
				return next;
			});
			return { plugin: this.view(updated, this.readState()), changed: true };
		} finally {
			rmSync(staged.tmp, { recursive: true, force: true });
		}
	}

	/** Removes the declaration, then the record, then trust when no scope still has the plugin. Keeps data. */
	async uninstall(name: string, options: { scope?: PluginScope }): Promise<void> {
		const scope = options.scope ?? "user";
		const record = this.resolveRecord(name, scope);
		await this.store.withLock(async () => {
			const settings = this.openSettings(scope);
			const baseDir = scope === "user" ? this.agentDir : this.cwd;
			const before = this.readState();
			const declarations = this.declarations(settings, scope).filter(
				(candidate) => this.declarationIdentity(candidate, baseDir, before) !== record.identity,
			);
			await this.saveSettings(settings, () =>
				scope === "user" ? settings.setPlugins(declarations) : settings.setProjectPlugins(declarations),
			);
			this.failpoint?.("declaration");
			const state = this.readState();
			state.plugins = state.plugins.filter(
				(other) => !(other.identity === record.identity && other.scope === record.scope),
			);
			if (!state.plugins.some((other) => other.identity === record.identity)) {
				state.trusted = state.trusted.filter((identity) => identity !== record.identity);
			}
			this.store.write(state);
			this.failpoint?.("record");
		});
	}

	/** Turns a plugin on or off in its scope. Turning on an untrusted plugin needs `trust` or a yes from `confirm`. */
	async setEnabled(
		name: string,
		enabled: boolean,
		options: { scope?: PluginScope; trust?: boolean; confirm?: TrustConfirm },
	): Promise<{ plugin: PluginView; trusted: boolean }> {
		const scope = options.scope ?? "user";
		const record = this.resolveRecord(name, scope);
		const initial = this.readState();
		let trusted = initial.trusted.includes(record.identity) || options.trust === true;
		if (enabled && !trusted && options.confirm) {
			const inventory = this.view(record, initial).inventory;
			trusted = await options.confirm(describeInventory(inventory), inventory);
		}
		await this.store.withLock(async () => {
			const settings = this.openSettings(scope);
			const state = this.readState();
			if (enabled && trusted && !state.trusted.includes(record.identity)) {
				state.trusted.push(record.identity);
				this.store.write(state);
			}
			const baseDir = scope === "user" ? this.agentDir : this.cwd;
			const declarations = this.declarations(settings, scope);
			const index = declarations.findIndex(
				(candidate) => this.declarationIdentity(candidate, baseDir, state) === record.identity,
			);
			const base: PluginDeclaration =
				index === -1
					? {
							source: record.source,
							...(record.ref ? { ref: record.ref } : {}),
							...(record.path ? { path: record.path } : {}),
						}
					: declarations[index]!;
			const { enabled: _, ...rest } = base;
			const next = enabled ? rest : { ...rest, enabled: false };
			if (index === -1) declarations.push(next);
			else declarations[index] = next;
			await this.saveSettings(settings, () =>
				scope === "user" ? settings.setPlugins(declarations) : settings.setProjectPlugins(declarations),
			);
		});
		return { plugin: this.view(record, this.readState()), trusted };
	}

	/**
	 * The plugins a session in this directory loads: declared, installed, trusted and enabled. Reads local state only;
	 * it never fetches. A project declaration overrides the user's for the same identity.
	 */
	loadActive(projectTrusted: boolean): { plugins: ActivePlugin[]; diagnostics: string[] } {
		const diagnostics: string[] = [];
		let state: ReturnType<PluginStore["read"]>;
		try {
			state = this.readState();
		} catch (error) {
			return { plugins: [], diagnostics: [errorText(error)] };
		}
		const settings = SettingsManager.create(this.cwd, this.agentDir, { projectTrusted });
		for (const error of settings.drainErrors()) diagnostics.push(`plugin settings: ${error.error.message}`);
		const chosen = new Map<string, { declaration: PluginDeclaration; scope: PluginScope; record?: InstallRecord }>();
		const scopes: Array<[PluginScope, string, PluginDeclaration[]]> = [
			["user", this.agentDir, this.declarations(settings, "user")],
			...(projectTrusted
				? [["project", this.cwd, this.declarations(settings, "project")] as [PluginScope, string, PluginDeclaration[]]]
				: []),
		];
		for (const [scope, baseDir, declarations] of scopes) {
			for (const declaration of declarations) {
				const identity = this.declarationIdentity(declaration, baseDir, state);
				if (!identity) {
					diagnostics.push(
						`plugin "${declaration.source}" in ${scope} settings cannot be resolved; run ${installCommand(declaration, scope === "project")}`,
					);
					continue;
				}
				const key = scope === "user" ? "user" : this.projectKey;
				let record = state.plugins.find((candidate) => candidate.identity === identity && candidate.scope === key);
				const user = chosen.get(identity);
				if (
					!record &&
					scope === "project" &&
					user?.record &&
					(!declaration.ref || declaration.ref === user.declaration.ref)
				) {
					record = user.record;
				}
				chosen.set(identity, { declaration, scope, ...(record ? { record } : {}) });
			}
		}
		const plugins: ActivePlugin[] = [];
		for (const [identity, { declaration, scope, record }] of chosen) {
			if (!record) {
				diagnostics.push(
					`plugin "${declaration.source}" is declared in ${scope} settings but not installed; run ${installCommand(declaration, scope === "project")}`,
				);
				continue;
			}
			if (declaration.enabled === false) continue;
			if (!state.trusted.includes(identity)) {
				diagnostics.push(
					`plugin "${record.name}" is not trusted; run knightcode plugin enable ${record.namespace}${scope === "project" ? " -l" : ""} --trust`,
				);
				continue;
			}
			const inventory = this.store.readInventory(record.id, record.revision);
			if (!inventory) {
				diagnostics.push(
					`plugin "${record.name}" revision ${record.revision} is missing; run knightcode plugin update ${record.namespace}`,
				);
				continue;
			}
			const clash = plugins.find((plugin) => plugin.namespace === record.namespace);
			if (clash) {
				diagnostics.push(
					`plugin ${identity} is inactive: namespace "${record.namespace}" is already used by ${clash.identity}`,
				);
				continue;
			}
			plugins.push({
				identity,
				name: record.name,
				namespace: record.namespace,
				scope,
				commit: record.commit,
				revision: record.revision,
				root: this.store.pluginRoot(record.id, record.revision),
				dataDir: this.store.dataDir(record.id),
				inventory,
			});
		}
		return { plugins, diagnostics };
	}

	// ---------------------------------------------------------------------------------------------------------------
	// Marketplaces

	private async stageMarketplace(source: string, ref: string | undefined) {
		const parsed = parseSource(source, this.cwd);
		if ("error" in parsed) throw new Error(parsed.error);
		if (parsed.kind === "marketplace") throw new Error("a marketplace source is a repository or a directory");
		const tmp = this.store.tempDir();
		try {
			let tree: string;
			let commit: string | undefined;
			if (parsed.kind === "local") {
				tree = parsed.dir;
			} else {
				commit = await resolveRemoteCommit(parsed.url, ref ?? parsed.ref, this.git);
				tree = join(tmp, "src");
				await fetchCommit(parsed.url, commit, tree, this.git);
			}
			const stage = join(tmp, "revision");
			copyContent(tree, stage);
			commit ??= hashTree(stage);
			const catalog = readMarketplace(stage);
			return {
				tmp,
				stage,
				commit,
				catalog,
				canonical: parsed.canonical,
				declaredSource: parsed.kind === "local" ? parsed.dir : source,
			};
		} catch (error) {
			rmSync(tmp, { recursive: true, force: true });
			throw error;
		}
	}

	private marketplaceView(
		record: MarketplaceRecord,
		state: ReturnType<PluginStore["read"]>,
		scope: PluginScope,
	): MarketplaceView {
		let catalog: MarketplaceCatalog | undefined;
		let error: string | undefined;
		try {
			catalog = this.catalog(record);
		} catch (caught) {
			error = errorText(caught);
		}
		const installed = new Set(
			this.visibleRecords(state).flatMap((plugin) => (plugin.marketplace === record.name ? [plugin.source] : [])),
		);
		return {
			name: record.name,
			scope,
			source: record.source,
			...(record.ref ? { ref: record.ref } : {}),
			...(catalog?.description ? { description: catalog.description } : {}),
			commit: record.commit,
			updatedAt: record.updatedAt,
			plugins: (catalog?.plugins ?? []).map((entry) => ({
				name: entry.name,
				...(entry.description ? { description: entry.description } : {}),
				...(entry.version ? { version: entry.version } : {}),
				installed: installed.has(`${entry.name}@${record.name}`),
			})),
			diagnostics: error ? [error] : (catalog?.diagnostics ?? []),
		};
	}

	/** Adds a catalog. Nothing in it is installed or activated. */
	async addMarketplace(source: string, options: { scope?: PluginScope; ref?: string }): Promise<MarketplaceView> {
		const scope = options.scope ?? "user";
		this.scopeKey(scope);
		this.openSettings(scope);
		// A bare name picks a known marketplace: `knightcode plugin marketplace add claude-plugins-official`.
		const known =
			"error" in parseSource(source, this.cwd)
				? knownMarketplaces().find((market) => market.name === source.trim())
				: undefined;
		const ref = options.ref ?? known?.ref;
		const staged = await this.stageMarketplace(known?.source ?? source, ref);
		try {
			const name = staged.catalog.name;
			if (!sanitizePluginName(name) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
				throw new Error(`marketplace name "${name}" must use letters, digits, ".", "_" and "-"`);
			}
			return await this.store.withLock(async () => {
				const settings = this.openSettings(scope);
				const state = this.readState();
				const existing = state.marketplaces.find((record) => record.name === name);
				if (existing && existing.canonical !== staged.canonical) {
					throw new Error(`a different marketplace named "${name}" is already added (${existing.source})`);
				}
				const id = `${sanitizePluginName(name)}-${sha256(staged.canonical).slice(0, 10)}`;
				const revision = sha256(staged.commit).slice(0, 16);
				this.store.commitRevision(staged.stage, this.store.marketplaceRoot(id, revision));
				const record: MarketplaceRecord = {
					name,
					source: staged.declaredSource,
					...(ref ? { ref } : {}),
					canonical: staged.canonical,
					id,
					commit: staged.commit,
					revision,
					updatedAt: new Date().toISOString(),
				};
				state.marketplaces = [...state.marketplaces.filter((other) => other.name !== name), record];
				this.store.write(state);
				const declarations = [
					...(
						(scope === "user" ? settings.getGlobalSettings() : settings.getProjectSettings()).pluginMarketplaces ?? []
					).filter((declaration) => declaration.name !== name),
					{ name, source: record.source, ...(ref ? { ref } : {}) },
				];
				await this.saveSettings(settings, () =>
					scope === "user"
						? settings.setPluginMarketplaces(declarations)
						: settings.setProjectPluginMarketplaces(declarations),
				);
				return this.marketplaceView(record, state, scope);
			});
		} finally {
			rmSync(staged.tmp, { recursive: true, force: true });
		}
	}

	/**
	 * Names of the catalogs declared in the user's settings and, when it is trusted, the current project's, with the
	 * scope that declares each (the user's when both do).
	 */
	private declaredMarketplaces(): Map<string, PluginScope> {
		const projectTrusted = new ProjectTrustStore(this.agentDir).get(this.cwd) === true;
		const settings = SettingsManager.create(this.cwd, this.agentDir, { projectTrusted });
		const declared = new Map<string, PluginScope>();
		for (const { name } of projectTrusted ? (settings.getProjectSettings().pluginMarketplaces ?? []) : []) {
			declared.set(name, "project");
		}
		for (const { name } of settings.getGlobalSettings().pluginMarketplaces ?? []) declared.set(name, "user");
		return declared;
	}

	/** Marketplaces offered but not added here: the built-in ones, and Claude Code's and Grok Build's. */
	availableMarketplaces(): KnownMarketplace[] {
		let added: MarketplaceRecord[];
		try {
			const declared = this.declaredMarketplaces();
			added = this.readState().marketplaces.filter((record) => declared.has(record.name));
		} catch {
			return [];
		}
		return knownMarketplaces().filter(
			(market) =>
				!added.some((record) => record.name === market.name || record.canonical === marketplaceKey(market.source)),
		);
	}

	/**
	 * Plugins Claude Code or Grok Build installed for the user that are not installed here, each with the
	 * `name@marketplace` that installs it. One from a marketplace KnightCode cannot name is left out.
	 */
	importablePlugins(): ImportablePlugin[] {
		let state: ReturnType<PluginStore["read"]>;
		try {
			state = this.readState();
		} catch {
			return [];
		}
		const declared = this.declaredMarketplaces();
		const markets = [
			...state.marketplaces.filter((record) => declared.has(record.name)),
			...this.availableMarketplaces().map((market) => ({
				name: market.name,
				canonical: marketplaceKey(market.source),
			})),
		];
		const installed = new Set(this.visibleRecords(state).map((record) => record.name));
		const seen = new Set<string>();
		return foreignPlugins().flatMap((plugin) => {
			const key = plugin.marketplace.source ? marketplaceKey(plugin.marketplace.source) : undefined;
			const market =
				markets.find((candidate) => candidate.name === plugin.marketplace.name) ??
				(key ? markets.find((candidate) => candidate.canonical === key) : undefined);
			const source = market ? `${plugin.name}@${market.name}` : undefined;
			if (!source || installed.has(plugin.name) || seen.has(source)) return [];
			seen.add(source);
			return [{ name: plugin.name, from: plugin.from, source, enabled: plugin.enabled }];
		});
	}

	/** Catalogs declared in the user's settings and, when it is trusted, the current project's. */
	listMarketplaces(): MarketplaceView[] {
		const state = this.readState();
		const declared = this.declaredMarketplaces();
		return state.marketplaces.flatMap((record) => {
			const scope = declared.get(record.name);
			return scope ? [this.marketplaceView(record, state, scope)] : [];
		});
	}

	/** Fetches catalogs again: the named one, or every declared one. */
	async updateMarketplaces(name?: string): Promise<MarketplaceView[]> {
		const declared = this.listMarketplaces();
		const scopeOf = (marketName: string) => declared.find((view) => view.name === marketName)?.scope ?? "user";
		const names = name ? [name] : declared.map((view) => view.name);
		const updated: MarketplaceView[] = [];
		for (const marketName of names) {
			const record = this.readState().marketplaces.find((candidate) => candidate.name === marketName);
			if (!record) throw new Error(`no marketplace named "${marketName}"`);
			const staged = await this.stageMarketplace(record.source, record.ref);
			try {
				updated.push(
					await this.store.withLock(async () => {
						const state = this.readState();
						const revision = sha256(staged.commit).slice(0, 16);
						this.store.commitRevision(staged.stage, this.store.marketplaceRoot(record.id, revision));
						const next = { ...record, commit: staged.commit, revision, updatedAt: new Date().toISOString() };
						state.marketplaces = state.marketplaces.map((other) => (other.name === record.name ? next : other));
						this.store.write(state);
						return this.marketplaceView(next, state, scopeOf(record.name));
					}),
				);
			} finally {
				rmSync(staged.tmp, { recursive: true, force: true });
			}
		}
		return updated;
	}

	/** Removes a catalog from a scope. Plugins installed from it stay installed. */
	async removeMarketplace(name: string, options: { scope?: PluginScope }): Promise<void> {
		const scope = options.scope ?? "user";
		this.scopeKey(scope);
		await this.store.withLock(async () => {
			const settings = this.openSettings(scope);
			const own =
				(scope === "user" ? settings.getGlobalSettings() : settings.getProjectSettings()).pluginMarketplaces ?? [];
			if (!own.some((declaration) => declaration.name === name)) {
				throw new Error(`no marketplace named "${name}" in ${scope} settings`);
			}
			const remaining = own.filter((declaration) => declaration.name !== name);
			await this.saveSettings(settings, () =>
				scope === "user" ? settings.setPluginMarketplaces(remaining) : settings.setProjectPluginMarketplaces(remaining),
			);
		});
	}
}
