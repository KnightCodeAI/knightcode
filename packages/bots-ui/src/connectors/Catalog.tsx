// Connect Apps: one searchable catalog grouped by category, with what is recommended first. Entries show the app's
// name, icon and maker only; which source supplies an entry is internal and never shown.
import { CATALOG_CATEGORIES, type CatalogCategory, type CatalogEntry } from "@knightcode/bots-protocol";
import { ArrowUpRight, ChevronDown, ChevronRight, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Menu, MenuItem } from "../primitives/Menu.tsx";
import { navigate, useQueryParam } from "../shell/routes.ts";
import { useResource } from "../state/store.ts";
import { ConnectorPage } from "./ConnectorPage.tsx";

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
	developer: "Developer tools",
	productivity: "Productivity",
	"google-workspace": "Google Workspace",
	"microsoft-365": "Microsoft 365",
	"crm-sales": "CRM and sales",
	"marketing-social": "Marketing and social",
	seo: "SEO",
	support: "Support",
	hr: "HR",
	finance: "Finance",
	data: "Data",
};

/** Categories shown as chips before the rest go under More. */
const VISIBLE_CHIPS = 5;
/** Rows a section shows before View all. */
const SECTION_ROWS = 6;

/** The catalog dialog, or one app's page inside it when `appId` is set. */
export function Catalog({ appId, onClose }: { appId?: string; onClose: () => void }) {
	const { data } = useResource("catalog", (api) => api.listCatalog({}));
	const entries = data?.entries ?? [];
	return (
		<BrowserDialog title="Connect Apps" onClose={onClose} side={<ConnectedButton entries={entries} />}>
			{appId ? <ConnectorPage appId={appId} /> : <CatalogBrowser entries={entries} />}
		</BrowserDialog>
	);
}

type Filter = CatalogCategory | "all" | "connected" | "recommended";

interface CatalogSection {
	id: string;
	title: string;
	entries: CatalogEntry[];
	/** More than a section shows: View all switches to the full list. */
	more: boolean;
}

/**
 * The sections for `filter`. In the All view an app appears once: recommended apps (not yet connected, in catalog
 * order) come first and are left out of their category's section.
 */
export function catalogSections(
	found: CatalogEntry[],
	categories: CatalogCategory[],
	filter: Filter,
): CatalogSection[] {
	const full = (id: string, title: string, entries: CatalogEntry[]) => [{ id, title, entries, more: false }];
	if (filter === "connected")
		return full(
			"connected",
			"Your apps",
			found.filter((e) => e.connection),
		);
	const candidates = found.filter((e) => !e.connection);
	if (filter === "recommended") return full("recommended", "Recommended for you", candidates);
	if (filter !== "all")
		return full(
			filter,
			CATEGORY_LABELS[filter],
			found.filter((e) => e.category === filter),
		);
	const recommended = candidates.slice(0, SECTION_ROWS);
	const shown = new Set(recommended.map((e) => e.id));
	const capped = (id: string, title: string, entries: CatalogEntry[], total = entries.length) => ({
		id,
		title,
		entries: entries.slice(0, SECTION_ROWS),
		more: total > SECTION_ROWS,
	});
	return [
		capped("recommended", "Recommended for you", recommended, candidates.length),
		...categories.map((c) =>
			capped(
				c,
				CATEGORY_LABELS[c],
				found.filter((e) => e.category === c && !shown.has(e.id)),
			),
		),
	].filter((section) => section.entries.length > 0);
}

function CatalogBrowser({ entries }: { entries: CatalogEntry[] }) {
	const [query, setQuery] = useState("");
	const view = useQueryParam("view");
	const [filter, setFilter] = useState<Filter>(view === "connected" ? "connected" : "all");
	const needle = query.trim().toLowerCase();
	const matches = (e: CatalogEntry) =>
		!needle || `${e.name} ${e.maker} ${e.description}`.toLowerCase().includes(needle);
	const categories = CATALOG_CATEGORIES.filter((c) => entries.some((e) => e.category === c));
	const sections = catalogSections(entries.filter(matches), categories, filter);
	return (
		<>
			<SearchRow
				label="Search apps"
				placeholder="Search across apps and skills"
				value={query}
				onChange={setQuery}
				side={
					<button
						type="button"
						className="kb-browser__side"
						onClick={() => navigate({ name: "new", tab: "templates" })}
					>
						<span className="kb-browser__side-mark" aria-hidden>
							<BotAvatarView shape="blob" color="black" size={18} />
						</span>
						Bot templates
						<ArrowUpRight size={16} className="kb-browser__side-arrow" />
					</button>
				}
			/>
			<Chips
				label="Categories"
				value={filter}
				onChange={(next) => setFilter(next as Filter)}
				items={[{ value: "all", label: "All" }, ...categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]}
			/>
			<div className="kb-browser__scroll">
				{sections.map((section) => (
					<Section
						key={section.id}
						title={section.title}
						more={section.more ? () => setFilter(section.id as Filter) : undefined}
						empty={section.id === "connected" ? "No apps connected yet." : undefined}
					>
						{section.entries.map((entry) => (
							<AppRow key={entry.id} entry={entry} />
						))}
					</Section>
				))}
				{needle && sections.every((s) => s.entries.length === 0) && (
					<p className="kb-browser__empty">No apps match "{query}".</p>
				)}
			</div>
		</>
	);
}

/** One app: open its page, or connect from the row. */
function AppRow({ entry }: { entry: CatalogEntry }) {
	const href = `/connectors/${encodeURIComponent(entry.id)}`;
	const state = entry.connection?.status;
	return (
		<Row
			icon={<AppTile entry={entry} />}
			title={entry.name}
			detail={
				state === "connected"
					? "Connected"
					: state === "reconnect"
						? "Needs sign-in"
						: // The maker only adds something when it is not the app's own name.
							entry.maker !== entry.name
							? entry.maker
							: undefined
			}
			href={href}
			action={
				<button
					type="button"
					className="kb-pill"
					onClick={() => navigate(state === "connected" ? href : `${href}?connect=1`)}
					aria-label={`${state === "connected" ? "Manage" : state === "reconnect" ? "Reconnect" : "Connect"} ${entry.name}`}
				>
					{state === "connected" ? "Manage" : state === "reconnect" ? "Reconnect" : "Connect"}
				</button>
			}
		/>
	);
}

/** The app's tile: its icon, or its initial until icons arrive. */
export function AppTile({ entry, size = 40 }: { entry: Pick<CatalogEntry, "name" | "icon">; size?: number }) {
	// Marked like an avatar so screenshot comparisons leave the artwork out.
	return (
		<span
			className="kb-app-tile"
			data-app-icon={entry.icon}
			style={{ width: size, height: size, borderRadius: size * 0.275 }}
			aria-hidden
		>
			<span className="kb-app-tile__glyph" style={{ fontSize: size * 0.42 }}>
				{entry.name.slice(0, 1)}
			</span>
		</span>
	);
}

/** "N connected": the user's apps, at the top right of the dialog. */
function ConnectedButton({ entries }: { entries: CatalogEntry[] }) {
	const mine = entries.filter((e) => e.connection);
	return (
		<button
			type="button"
			className="kb-browser__connected"
			aria-label="Your apps"
			data-ref="app-connect"
			onClick={() => navigate("/connectors?view=connected")}
		>
			<span className="kb-browser__stack">
				{mine.slice(0, 2).map((entry) => (
					<span key={entry.id} className="kb-browser__stack-item">
						<AppTile entry={entry} size={18} />
					</span>
				))}
			</span>
			<span>{mine.length} connected</span>
			<ChevronRight size={16} />
		</button>
	);
}

// ─── The browsing layout shared with the skills library ─────────────────────────────────────────────

/** The 900 x 702 browsing dialog: a title row with a side button, then the caller's content. */
export function BrowserDialog({
	title,
	side,
	onClose,
	children,
}: {
	title: string;
	side?: ReactNode;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title={title}
			bare
			width={900}
			closeSize={28}
			className="kb-browser"
			dataRef="dialog"
		>
			{/* A page-sized browser: while open it is the page's main content (everything behind it is inert). */}
			<div className="kb-browser__body" role="main">
				<div className="kb-browser__head">
					<h2 className="kb-browser__title" data-ref="dialog-title">
						{title}
					</h2>
					{side && <div className="kb-browser__head-side">{side}</div>}
				</div>
				{children}
			</div>
		</Dialog>
	);
}

/** The search field and an action beside it. */
export function SearchRow(props: {
	label: string;
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
	side?: ReactNode;
}) {
	return (
		<div className="kb-browser__search-row">
			<label className="kb-search-box">
				<Search size={14} className="kb-search-box__icon" aria-hidden />
				<input
					type="search"
					aria-label={props.label}
					placeholder={props.placeholder}
					value={props.value}
					onChange={(event) => props.onChange(event.target.value)}
					data-ref="search"
				/>
			</label>
			{props.side}
		</div>
	);
}

/** Filter chips; past five, the rest go under More. */
export function Chips({
	label,
	value,
	onChange,
	items,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	items: { value: string; label: string }[];
}) {
	const shown = items.slice(0, VISIBLE_CHIPS + 1);
	const rest = items.slice(VISIBLE_CHIPS + 1);
	let inactive = 0;
	return (
		<div className="kb-chips" role="group" aria-label={label}>
			{shown.map((item) => {
				const active = item.value === value;
				const ref = active ? "chip-active" : inactive++ === 0 ? "chip" : undefined;
				return (
					<button
						key={item.value}
						type="button"
						className="kb-chip-filter"
						aria-pressed={active}
						data-ref={ref}
						onClick={() => onChange(item.value)}
					>
						{item.label}
					</button>
				);
			})}
			{rest.length > 0 && (
				<Menu
					label="More categories"
					trigger={
						<button type="button" className="kb-chip-filter" aria-pressed={rest.some((r) => r.value === value)}>
							More <ChevronDown size={16} />
						</button>
					}
				>
					{rest.map((item) => (
						<MenuItem key={item.value} onSelect={() => onChange(item.value)}>
							{item.label}
						</MenuItem>
					))}
				</Menu>
			)}
		</div>
	);
}

/** A titled group of rows, two to a line, with View all when there are more. */
export function Section({
	title,
	more,
	empty,
	children,
}: {
	title: string;
	more?: () => void;
	empty?: string;
	children: ReactNode;
}) {
	const list = Array.isArray(children) ? children : [children];
	if (list.length === 0 && !empty) return null;
	return (
		<section className="kb-browser__section">
			<div className="kb-browser__section-head">
				<h3 className="kb-browser__section-title" data-ref="section-title">
					{title}
				</h3>
				{more && (
					<button type="button" className="kb-browser__more" onClick={more} data-ref="view-all">
						View all
					</button>
				)}
			</div>
			{list.length === 0 ? (
				<p className="kb-browser__empty">{empty}</p>
			) : (
				<ul className="kb-browser__grid">{children}</ul>
			)}
		</section>
	);
}

/** One row: an icon and name that open the item, and an action on the right. */
export function Row({
	icon,
	title,
	detail,
	href,
	onOpen,
	action,
}: {
	icon: ReactNode;
	title: string;
	detail?: string;
	href?: string;
	onOpen?: () => void;
	action?: ReactNode;
}) {
	const content = (
		<>
			{icon}
			<span className="kb-browser__main">
				<span className="kb-browser__name">{title}</span>
				{detail && <span className="kb-browser__detail">{detail}</span>}
			</span>
		</>
	);
	return (
		<li className="kb-browser__row" data-ref="app-row">
			{href ? (
				<a
					className="kb-browser__open"
					href={href}
					onClick={(event) => {
						event.preventDefault();
						navigate(href);
					}}
				>
					{content}
				</a>
			) : (
				<button type="button" className="kb-browser__open" onClick={onOpen}>
					{content}
				</button>
			)}
			{action}
		</li>
	);
}
