/** Settings › Plugins: installed plugins, imports and marketplaces. */
import {
	experimental_appearance,
	experimental_Button as Button,
	experimental_controllers,
	experimental_controls,
	experimental_icons,
	experimental_pickerServices,
	experimental_settingsControls,
	experimental_settingsServices as services,
	experimental_shellServices,
	experimental_useThreadList,
	experimental_useUpdate,
	type experimental_SettingsRequests as Requests,
} from "@knightcodeai/cli/desktop";
import { Fragment, type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
	Archive,
	Box,
	Card,
	Check,
	ChevronDown,
	ChevronRight,
	ConfigFields,
	ConfirmDialog,
	Copy,
	DeleteThreadDialog,
	Dialog,
	DialogActions,
	Download,
	ExternalLink,
	Folder,
	IconButton,
	Import,
	KeyRound,
	levelName,
	ListFilter,
	LogIn,
	LogOut,
	Menu,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
	MessageSquare,
	ModelList,
	MoreHorizontal,
	NavRow,
	openFile,
	PageBar,
	PageBody,
	PageHeader,
	Pencil,
	Plus,
	Popover,
	RefreshCw,
	Row,
	ScopeCard,
	SearchField,
	Section,
	Segmented,
	SelectMenu,
	SizeField,
	Spinner,
	SquarePen,
	Switch,
	Tabs,
	Tooltip,
	Trash2,
	useProjectTrust,
} from "./ui.tsx";

type PluginRow = Requests["plugin/list"]["result"]["plugins"][number];
type MarketplaceRow = Requests["plugin/marketplace/list"]["result"]["marketplaces"][number];
type CatalogEntry = MarketplaceRow["plugins"][number];

/** Catalogs older than this are fetched again when the page opens, as `/plugins` does. */
const CATALOG_TTL_MS = 5 * 60 * 1000;
/** How many of a marketplace's plugins show until "Show all". */
const CATALOG_PREVIEW = 20;
/** How many of a plugin's skills or commands its details name until "Show all". */
const DETAIL_PREVIEW = 24;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const TAG_TONES = {
	neutral: "bg-soft-alt text-secondary",
	accent: "bg-accent/10 text-accent",
	warning: "bg-warning/10 text-warning",
};

/** A status beside a title, drawn as the question panel's Recommended badge. */
const Tag = ({ tone = "neutral", children }: { tone?: keyof typeof TAG_TONES; children: ReactNode }) => (
	<span
		className={`inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs leading-none font-normal ${TAG_TONES[tone]}`}
	>
		{children}
	</span>
);

/** The last control of a row that opens more under it; its chevron turns over while open. */
const Disclosure = ({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) => (
	<IconButton label={label} toolbar aria-expanded={open} onClick={onToggle}>
		<ChevronDown
			size={16}
			className={`transition-[rotate] duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
		/>
	</IconButton>
);

/** A plugin's or catalog's source to add, and where to save it. */
function AddPluginSourceDialog({
	title,
	placeholder,
	action,
	cwd,
	onAdd,
	onClose,
}: {
	title: string;
	placeholder: string;
	action: string;
	cwd: string | undefined;
	onAdd: (params: { source: string; ref?: string; scope: "global" | "project" }) => Promise<unknown>;
	onClose: () => void;
}) {
	const [source, setSource] = useState("");
	const [ref, setRef] = useState("");
	const [scope, setScope] = useState<"global" | "project">("global");
	const [busy, setBusy] = useState(false);
	const valid = source.trim() !== "" && !busy;
	const add = () => {
		setBusy(true);
		void onAdd({ source: source.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}), scope })
			.then(onClose)
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			)
			.finally(() => setBusy(false));
	};
	return (
		<Dialog title={title} onClose={onClose}>
			<div className="flex flex-col items-start gap-3 pt-3">
				<input
					autoFocus
					aria-label="Source"
					value={source}
					spellCheck={false}
					placeholder={placeholder}
					onChange={(e) => setSource(e.target.value)}
					onKeyDown={(e) =>
						valid && experimental_shellServices().experimental_matches(e, "desktop.item.activate") && add()
					}
					className="kc-input font-code text-xs"
				/>
				<input
					aria-label="Ref"
					value={ref}
					spellCheck={false}
					placeholder="Branch, tag or commit (optional)"
					onChange={(e) => setRef(e.target.value)}
					className="kc-input font-code text-xs"
				/>
				{cwd ? (
					<Segmented
						label="Save to"
						value={scope}
						onChange={setScope}
						options={[
							{ value: "global", label: "User" },
							{ value: "project", label: "This project" },
						]}
					/>
				) : null}
			</div>
			<DialogActions>
				<Button color="secondary" size="lg" squircle className="px-4" onClick={onClose}>
					Cancel
				</Button>
				<Button variant="solid" size="lg" squircle className="px-4" disabled={!valid} onClick={add}>
					{busy ? "Working…" : action}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

/** A plugin's row text: what it offers, then its description, as `/plugins` writes it. */
function pluginSummary(plugin: PluginRow): string {
	const offers = [
		...(plugin.skills.length ? [plural(plugin.skills.length, "skill")] : []),
		...(plugin.commands.length ? [plural(plugin.commands.length, "command")] : []),
		...(plugin.mcpServers.length ? [plural(plugin.mcpServers.length, "MCP server")] : []),
	].join(", ");
	return [offers, plugin.description].filter(Boolean).join(" · ");
}

/**
 * Everything a plugin holds: what it runs first (its MCP servers and the environment they read), then what it offers.
 * Its own skills drop the `<plugin>:` they all carry. Under its row once opened, and in the trust question.
 */
function PluginDetails({ plugin, className = "px-4 pb-3" }: { plugin: PluginRow; className?: string }) {
	const [whole, setWhole] = useState(false);
	const prefix = `${plugin.namespace}:`;
	const own = (name: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
	const counted = (term: string, count: number) => (count > 1 ? `${term} (${count})` : term);
	/** A long list shows its first names until "Show all", as a marketplace shows its first plugins. */
	const names = (all: string[]): ReactNode =>
		whole || all.length <= DETAIL_PREVIEW ? (
			all.join(", ")
		) : (
			<>
				{all.slice(0, DETAIL_PREVIEW).join(", ")}, …{" "}
				<button type="button" onClick={() => setWhole(true)} className="text-ink hover:underline">
					Show all {all.length}
				</button>
			</>
		);
	const facts: [string, ReactNode][] = [
		["Source", <span className="font-code">{plugin.ref ? `${plugin.source}#${plugin.ref}` : plugin.source}</span>],
		...plugin.mcpServers.map((server): [string, ReactNode] => [
			"MCP server",
			<>
				<span className="text-ink">{server.name}</span> <span className="font-code">{server.target}</span>
			</>,
		]),
		...(plugin.environment.length
			? [["Reads", <span className="font-code">{plugin.environment.join(", ")}</span>] as [string, ReactNode]]
			: []),
		...(plugin.commands.length
			? [
					[counted("Commands", plugin.commands.length), names(plugin.commands.map((command) => `/${command}`))] as [
						string,
						ReactNode,
					],
				]
			: []),
		...(plugin.skills.length
			? [[counted("Skills", plugin.skills.length), names(plugin.skills.map(own))] as [string, ReactNode]]
			: []),
		...(plugin.unsupported.length ? [["Never runs", plugin.unsupported.join(", ")] as [string, ReactNode]] : []),
	];
	return (
		<div className={`flex flex-col gap-2 ${className}`}>
			<dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
				{facts.map(([term, value], index) => (
					<Fragment key={index}>
						<dt className="text-tertiary">{term}</dt>
						<dd className="[overflow-wrap:anywhere] text-secondary">{value}</dd>
					</Fragment>
				))}
			</dl>
			{plugin.warnings.map((warning) => (
				<p key={warning} className="text-xs text-secondary">
					{warning}
				</p>
			))}
		</div>
	);
}

/**
 * Asked before a plugin is trusted: what it will run and offer, and what KnightCode never runs, in a panel that scrolls
 * when a plugin brings hundreds of skills.
 */
function TrustPluginDialog({
	plugin,
	onTrust,
	onClose,
}: {
	plugin: PluginRow;
	onTrust: () => void;
	onClose: () => void;
}) {
	return (
		<Dialog
			title={`Trust ${plugin.name}?`}
			description="New threads will run its MCP servers and offer its skills and commands."
			width={480}
			onClose={onClose}
		>
			<div className="pt-4">
				<PluginDetails
					plugin={plugin}
					className="max-h-[min(320px,45vh)] overflow-y-auto rounded-lg bg-card-soft px-3 py-2.5 shadow-[0_0_0_0.5px_var(--kc-border-strong)]"
				/>
			</div>
			<DialogActions>
				<Button color="secondary" size="lg" squircle className="px-4" onClick={onClose}>
					Not now
				</Button>
				<Button
					variant="solid"
					size="lg"
					squircle
					className="px-4"
					onClick={() => {
						onTrust();
						onClose();
					}}
				>
					Trust and activate
				</Button>
			</DialogActions>
		</Dialog>
	);
}

/** A set with `value` added or taken out, for toggles held in state. */
function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
	const next = new Set(set);
	if (!next.delete(value)) next.add(value);
	return next;
}

/**
 * Plugins (Claude Code and Grok Build), as `/plugins` lays them out: Installed (the user's and the project's, then the
 * ones Claude Code and Grok Build have to import) and Marketplace (every known marketplace with its whole catalog;
 * installing from one adds it). A plugin runs nothing until it is trusted. Sign-in and live status of plugin MCP
 * servers stay with `/mcp` in a thread, since the MCP page lists only mcp.json servers.
 */
export function Plugins() {
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	const [tab, setTab] = useState<"installed" | "marketplace">("installed");
	const [query, setQuery] = useState("");
	// Tagged with its scope, newest request only: another project's list never shows (or gets acted on) under this one.
	const [loaded, setLoaded] = useState<{
		cwd: string | undefined;
		plugins: Requests["plugin/list"]["result"];
		marketplaces: MarketplaceRow[];
	}>();
	const latest = useRef(0);
	const list = loaded && loaded.cwd === cwd ? loaded : undefined;
	/** One change at a time: the others wait until it settles, and `working` names the row it runs for. */
	const [busy, setBusy] = useState(false);
	const [working, setWorking] = useState<string>();
	const [adding, setAdding] = useState<"plugin" | "marketplace">();
	const [trusting, setTrusting] = useState<PluginRow>();
	const [removing, setRemoving] = useState<PluginRow>();
	const [removingMarket, setRemovingMarket] = useState<MarketplaceRow>();
	// Opened plugin details; marketplaces toggled from how they start (closed, unless there is only one); catalogs
	// showing every plugin.
	const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
	const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
	const [whole, setWhole] = useState<ReadonlySet<string>>(new Set());
	const [fetching, setFetching] = useState<ReadonlySet<string>>(new Set());
	const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
	const tried = useRef(new Set<string>());
	const where = cwd === undefined ? {} : { cwd };
	// The project shown now. A fetch or change that settles after a switch must not reload the old project, whose
	// request would then be the newest and leave this one loading.
	const shownCwd = useRef(cwd);
	shownCwd.current = cwd;
	/** Fetches and their failures belong to the project they ran in. */
	const catalogKey = (name: string) => `${cwd ?? ""}\n${name}`;
	const load = useCallback(() => {
		if (shownCwd.current !== cwd) return;
		const request = ++latest.current;
		const params = cwd === undefined ? {} : { cwd };
		Promise.all([
			services().experimental_request("plugin/list", params),
			services().experimental_request("plugin/marketplace/list", params),
		])
			.then(([plugins, markets]) => {
				if (request === latest.current) setLoaded({ cwd, plugins, marketplaces: markets.marketplaces });
			})
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	}, [cwd, trusted]);
	useEffect(load, [load]);
	const run = <T,>(key: string, request: () => Promise<T>, then?: (result: T) => void) => {
		setBusy(true);
		setWorking(key);
		void request()
			.then((result) => {
				then?.(result);
				load();
			})
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			)
			.finally(() => {
				setBusy(false);
				setWorking(undefined);
			});
	};
	const install = (params: { source: string; ref?: string; scope: "global" | "project" }) =>
		services()
			.experimental_request("plugin/install", { ...where, ...params })
			.then(({ plugin }) => setTrusting(plugin));
	const update = (plugin: PluginRow, key: string) =>
		run(
			key,
			() => services().experimental_request("plugin/update", { ...where, scope: plugin.scope, name: plugin.identity }),
			(result) =>
				experimental_controllers().experimental_notify(
					result.changed ? `Updated ${plugin.name}` : `${plugin.name} is up to date`,
					"info",
				),
		);
	/** Fetches a catalog again; its card shows the fetch and what went wrong. */
	const fetchCatalog = (name: string) => {
		const key = catalogKey(name);
		setFetching((keys) => new Set(keys).add(key));
		void services()
			.experimental_request("plugin/marketplace/update", { ...where, name })
			.then(
				() => undefined,
				(e: unknown) => services().experimental_errorText(e),
			)
			.then((failure) => {
				setFailed((failures) => {
					const next = new Map(failures);
					if (failure === undefined) next.delete(key);
					else next.set(key, failure);
					return next;
				});
				setFetching((keys) => {
					const next = new Set(keys);
					next.delete(key);
					return next;
				});
				load();
			});
	};
	// As `/plugins`: catalogs never fetched, or fetched a few minutes ago, are fetched in the background once.
	useEffect(() => {
		for (const market of list?.marketplaces ?? []) {
			const key = catalogKey(market.name);
			const stale = market.missing || !market.updatedAt || Date.now() - Date.parse(market.updatedAt) > CATALOG_TTL_MS;
			if (!stale || tried.current.has(key)) continue;
			tried.current.add(key);
			fetchCatalog(market.name);
		}
	}, [list]);

	const needle = query.trim().toLowerCase();
	const hit = (...texts: (string | undefined)[]) => texts.join(" ").toLowerCase().includes(needle);
	const installed = (list?.plugins.plugins ?? []).filter((plugin) =>
		hit(plugin.name, plugin.description, plugin.source),
	);
	const importable = (list?.plugins.importable ?? []).filter((plugin) => hit(plugin.name, plugin.source, plugin.from));
	const markets = list?.marketplaces ?? [];
	const updates = new Set(
		markets.flatMap((market) =>
			market.plugins.filter((entry) => entry.update).map((entry) => `${entry.name}@${market.name}`),
		),
	);
	const elsewhere = new Map((list?.plugins.importable ?? []).map((plugin) => [plugin.source, plugin.from]));

	const pluginRow = (plugin: PluginRow) => {
		const key = `${plugin.scope}:${plugin.identity}`;
		const open = opened.has(key);
		return (
			<Row
				key={key}
				title={
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						{plugin.name}
						{plugin.version ? <span className="text-xs font-normal text-tertiary">v{plugin.version}</span> : null}
						{plugin.trusted ? null : <Tag tone="warning">Not trusted</Tag>}
						{updates.has(plugin.source) ? <Tag tone="accent">Update available</Tag> : null}
					</span>
				}
				detail={<span className="line-clamp-2">{pluginSummary(plugin)}</span>}
				below={open ? <PluginDetails plugin={plugin} /> : undefined}
			>
				{working === key ? <Spinner size={16} className="text-secondary motion-safe:animate-spin" /> : null}
				<Switch
					label={`Enable ${plugin.name}`}
					checked={plugin.enabled && plugin.trusted}
					disabled={busy}
					onChange={(on) =>
						on && !plugin.trusted
							? setTrusting(plugin)
							: run(key, () =>
									services().experimental_request("plugin/set", {
										...where,
										scope: plugin.scope,
										name: plugin.identity,
										enabled: on,
									}),
								)
					}
				/>
				<Menu>
					<MenuTrigger>
						<IconButton label={`More for ${plugin.name}`} toolbar disabled={busy}>
							<MoreHorizontal size={16} />
						</IconButton>
					</MenuTrigger>
					<MenuContent align="end">
						<MenuItem icon={<RefreshCw size={16} />} onSelect={() => update(plugin, key)}>
							{updates.has(plugin.source) ? "Update" : "Check for updates"}
						</MenuItem>
						<MenuSeparator />
						<MenuItem icon={<Trash2 size={16} />} onSelect={() => setRemoving(plugin)}>
							Uninstall
						</MenuItem>
					</MenuContent>
				</Menu>
				<Disclosure
					open={open}
					label={open ? "Hide details" : "Show details"}
					onToggle={() => setOpened((keys) => toggled(keys, key))}
				/>
			</Row>
		);
	};

	const entryRow = (market: MarketplaceRow, entry: CatalogEntry) => {
		const source = `${entry.name}@${market.name}`;
		const key = `entry:${source}`;
		const mine = list?.plugins.plugins.find((plugin) => plugin.source === source);
		const from = entry.installed ? undefined : elsewhere.get(source);
		const by = [entry.version ? `v${entry.version}` : "", entry.author ? `by ${entry.author}` : ""]
			.filter(Boolean)
			.join(" · ");
		return (
			<Row
				key={entry.name}
				title={
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						{entry.name}
						{by ? <span className="text-xs font-normal text-tertiary">{by}</span> : null}
						{from ? <Tag>In {from}</Tag> : null}
					</span>
				}
				detail={entry.description ? <span className="line-clamp-2">{entry.description}</span> : undefined}
			>
				{entry.installed && entry.update && mine ? (
					<Button variant="soft" toolbar disabled={busy} onClick={() => update(mine, key)}>
						{working === key ? <Spinner size={16} className="motion-safe:animate-spin" /> : <RefreshCw size={16} />}
						Update
					</Button>
				) : entry.installed ? (
					<span className="flex items-center gap-1.5 text-sm text-secondary">
						<Check size={16} /> Installed
					</span>
				) : (
					<Button
						variant="soft"
						toolbar
						disabled={busy}
						onClick={() => run(key, () => install({ source, scope: "global" }))}
					>
						{working === key ? <Spinner size={16} className="motion-safe:animate-spin" /> : <Download size={16} />}
						{working === key ? "Installing…" : "Install"}
					</Button>
				)}
			</Row>
		);
	};

	const marketCard = (market: MarketplaceRow) => {
		const entries = market.plugins.filter(
			(entry) => !needle || hit(market.name) || hit(entry.name, entry.description, entry.author),
		);
		if (needle && entries.length === 0) return null;
		const open = needle ? true : (markets.length === 1) !== flipped.has(market.name);
		const shown = whole.has(market.name) ? entries : entries.slice(0, CATALOG_PREVIEW);
		const failure = failed.get(catalogKey(market.name));
		const busyFetching = fetching.has(catalogKey(market.name));
		// Git's whole stderr can be many lines: two show, and the rest is a hover away.
		const problem = (text: string) => (
			<Tooltip content={text}>
				<span className="line-clamp-2 text-danger-text">{text}</span>
			</Tooltip>
		);
		const detail = failure ? (
			problem(`Couldn't fetch the catalog: ${failure}`)
		) : market.missing ? (
			busyFetching ? (
				"Fetching the catalog…"
			) : (
				"Not fetched yet"
			)
		) : (
			<>
				{market.source} · {needle ? `${entries.length} of ${market.plugins.length}` : market.plugins.length}{" "}
				{market.plugins.length === 1 ? "plugin" : "plugins"}
				{market.diagnostics.length ? problem(market.diagnostics.join("; ")) : null}
			</>
		);
		return (
			<Box key={market.name}>
				<Row
					title={
						<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
							{market.name}
							<Tag>{market.from ?? "Added"}</Tag>
						</span>
					}
					detail={detail}
				>
					<IconButton
						label={`Refresh ${market.name}`}
						toolbar
						disabled={busyFetching}
						onClick={() => fetchCatalog(market.name)}
					>
						{busyFetching ? <Spinner size={16} className="motion-safe:animate-spin" /> : <RefreshCw size={16} />}
					</IconButton>
					{market.added ? (
						<IconButton
							label={`Remove ${market.name}`}
							toolbar
							disabled={busy}
							onClick={() => setRemovingMarket(market)}
						>
							<Trash2 size={16} />
						</IconButton>
					) : null}
					{needle ? null : (
						<Disclosure
							open={open}
							label={open ? "Hide plugins" : "Show plugins"}
							onToggle={() => setFlipped((names) => toggled(names, market.name))}
						/>
					)}
				</Row>
				{open ? shown.map((entry) => entryRow(market, entry)) : null}
				{open && shown.length < entries.length ? (
					<button
						type="button"
						onClick={() => setWhole((names) => toggled(names, market.name))}
						className="flex w-full items-center justify-center gap-1 rounded-b-2xl px-4 py-2.5 text-sm text-secondary hover:text-ink"
					>
						Show all {entries.length} plugins <ChevronDown size={14} />
					</button>
				) : null}
			</Box>
		);
	};

	const groups: [string, PluginRow[]][] = [
		["User", installed.filter((plugin) => plugin.scope === "global")],
		["This project", installed.filter((plugin) => plugin.scope === "project")],
	];
	const imports: [string, typeof importable][] = [
		["In Claude Code", importable.filter((plugin) => plugin.from === "Claude Code")],
		["In Grok Build", importable.filter((plugin) => plugin.from === "Grok Build")],
	];
	const count = (rows: unknown[]) => <span className="text-sm text-secondary">{plural(rows.length, "plugin")}</span>;
	const nothing = (text: string) => <div className="text-secondary">{text}</div>;
	const shownMarkets = markets.map(marketCard).filter(Boolean);
	return (
		<>
			<ScopeCard
				cwd={cwd}
				onCwd={setCwd}
				trusted={trusted}
				onTrust={setTrusted}
				detail="A trusted project adds the plugins its .knightcode/settings.json declares"
			/>
			<PageBar>
				<div className="flex items-center gap-2">
					<Tabs
						label="Plugins"
						value={tab}
						onChange={setTab}
						options={[
							{ value: "installed", label: "Installed" },
							{ value: "marketplace", label: "Marketplace" },
						]}
					/>
					<div className="ms-auto max-w-60 min-w-0 flex-1">
						<SearchField value={query} onChange={setQuery} placeholder="Search plugins" page />
					</div>
					<Button
						variant="soft"
						toolbar
						disabled={busy}
						onClick={() => setAdding(tab === "installed" ? "plugin" : "marketplace")}
					>
						<Plus size={16} /> {tab === "installed" ? "Install from source" : "Add marketplace"}
					</Button>
				</div>
			</PageBar>
			{list === undefined ? <div className="kc-pulse text-tertiary">Loading…</div> : null}
			{list && tab === "installed" ? (
				<>
					{list.plugins.plugins.length === 0 ? (
						<Card title="Installed">
							<Row
								title="No plugins installed"
								detail="Install one from a marketplace, or from a Git repository or folder"
							>
								<Button variant="soft" toolbar onClick={() => setTab("marketplace")}>
									Browse marketplace
								</Button>
							</Row>
						</Card>
					) : null}
					{needle && installed.length === 0 && importable.length === 0 ? nothing("No plugins match.") : null}
					{groups.map(([title, rows]) =>
						rows.length ? (
							<Card key={title} title={title} aside={count(rows)}>
								{rows.map(pluginRow)}
							</Card>
						) : null,
					)}
					{imports.map(([title, rows]) =>
						rows.length ? (
							<Card key={title} title={title} aside={count(rows)}>
								{rows.map((plugin) => {
									const key = `import:${plugin.from}:${plugin.source}`;
									return (
										<Row
											key={key}
											title={plugin.name}
											detail={`${plugin.source}${plugin.enabled ? "" : ` · turned off in ${plugin.from}`}`}
										>
											<Button
												variant="soft"
												toolbar
												disabled={busy}
												onClick={() => run(key, () => install({ source: plugin.source, scope: "global" }))}
											>
												{working === key ? (
													<Spinner size={16} className="motion-safe:animate-spin" />
												) : (
													<Download size={16} />
												)}
												{working === key ? "Importing…" : "Import"}
											</Button>
										</Row>
									);
								})}
							</Card>
						) : null,
					)}
				</>
			) : null}
			{list && tab === "marketplace" ? (
				<Section
					title="Marketplaces"
					aside={<span className="text-sm text-secondary">{plural(markets.length, "marketplace")}</span>}
				>
					{markets.length === 0 ? (
						<Box>
							<Row title="No marketplaces" detail="Add one to browse its plugins. Adding installs nothing" />
						</Box>
					) : null}
					{needle && markets.length > 0 && shownMarkets.length === 0 ? nothing("No plugins match.") : null}
					{shownMarkets}
				</Section>
			) : null}
			{list?.plugins.diagnostics.length ? (
				<Card title="Problems">
					{list.plugins.diagnostics.map((diagnostic) => (
						<Row key={diagnostic} title={<span className="font-normal text-danger-text">{diagnostic}</span>} />
					))}
				</Card>
			) : null}
			<Card>
				<Row
					title="When changes apply"
					detail="New and reloaded threads load plugin changes. Running threads keep the revision they loaded"
				/>
				<Row
					title="Plugin MCP servers"
					detail="Sign in to them, reconnect them or see their tools with /mcp in a thread"
				/>
			</Card>
			{adding ? (
				<AddPluginSourceDialog
					title={adding === "plugin" ? "Install from source" : "Add marketplace"}
					placeholder={
						adding === "plugin"
							? "owner/repo, a Git URL, a folder, or name@marketplace"
							: "owner/repo, a Git URL, or a folder"
					}
					action={adding === "plugin" ? "Install" : "Add"}
					cwd={trusted ? cwd : undefined}
					onAdd={(params) =>
						adding === "plugin"
							? install(params).then(load)
							: services()
									.experimental_request("plugin/marketplace/add", { ...where, ...params })
									.then(load)
					}
					onClose={() => setAdding(undefined)}
				/>
			) : null}
			{trusting ? (
				<TrustPluginDialog
					plugin={trusting}
					onTrust={() =>
						run(`${trusting.scope}:${trusting.identity}`, () =>
							services().experimental_request("plugin/set", {
								...where,
								scope: trusting.scope,
								name: trusting.identity,
								trust: true,
								enabled: true,
							}),
						)
					}
					onClose={() => setTrusting(undefined)}
				/>
			) : null}
			{removing ? (
				<ConfirmDialog
					title={`Uninstall ${removing.name}?`}
					description="Its settings entry and trust are removed. Its data directory is kept."
					confirm="Uninstall"
					onConfirm={() =>
						run(`${removing.scope}:${removing.identity}`, () =>
							services().experimental_request("plugin/uninstall", {
								...where,
								scope: removing.scope,
								name: removing.identity,
							}),
						)
					}
					onClose={() => setRemoving(undefined)}
				/>
			) : null}
			{removingMarket ? (
				<ConfirmDialog
					title={`Remove ${removingMarket.name}?`}
					description="Plugins installed from it stay installed."
					confirm="Remove"
					onConfirm={() =>
						run(`market:${removingMarket.name}`, () =>
							services().experimental_request("plugin/marketplace/remove", {
								...where,
								scope: removingMarket.scope ?? "global",
								name: removingMarket.name,
							}),
						)
					}
					onClose={() => setRemovingMarket(undefined)}
				/>
			) : null}
		</>
	);
}
