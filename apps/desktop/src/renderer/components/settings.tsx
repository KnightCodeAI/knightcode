/**
 * Settings (desktop-shell.md section 9.10), laid out as Codex's (measured 2026-10-19): the pages listed in the
 * sidebar's column under a search pill, grouped Personal and Coding; each page a 768px column with a 28px title and
 * sections of rows on #232323 cards (20px corners, rows 12px by 16px, 16px-inset hairlines between them). Desktop
 * preferences live in desktop-state.json; the default model and sign-ins go through the app server, so the terminal
 * sees the same choices.
 */

import type {
	Environment,
	LoginState,
	McpExposure,
	Resource,
	ResourceType,
	ResultOf,
	ThreadSummary,
} from "@knightcode/app-server-protocol";
import { type CSSProperties, Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { comboFromEvent, DESKTOP_KEYBINDINGS, type KeybindingId } from "../../shared/keybindings.ts";
import { client } from "../client.ts";
import {
	type ArchiveFilter,
	type ArchiveKind,
	type ArchiveSort,
	filterArchived,
	NO_PROJECT,
} from "../archive-filter.ts";
import {
	ACCENTS,
	BASE,
	type Customization,
	DEFAULT_CONTRAST,
	isHex,
	parseThemeString,
	themeString,
} from "../appearance.ts";
import { basename, samePath } from "../format.ts";
import { isMac, keyLabel, matches } from "../keys.ts";
import {
	answerLogin,
	checkForUpdates,
	customize,
	cancelLogin,
	deleteThread,
	errorText,
	listArchived,
	logout,
	navigate,
	openThread,
	refreshAccounts,
	selectPreferences,
	selectProjects,
	setDefaultModel,
	setKeybinding,
	setPreference,
	type SettingsPage,
	showNew,
	startLogin,
	toast,
	installUpdate,
	openUpdatePage,
	unarchive,
	useStore,
} from "../store.ts";
import { Button, IconButton, Segmented } from "./button.tsx";
import { levelName, ModelList } from "./composer-pickers.tsx";
import { ConfirmDialog, Dialog, DialogActions } from "./dialog.tsx";
import {
	Archive,
	Check,
	ChevronDown,
	ChevronRight,
	CircleUserRound,
	Code,
	Copy,
	Download,
	ExternalLink,
	Folder,
	GitBranch,
	Globe,
	Import,
	Info,
	Keyboard,
	KeyRound,
	Layers,
	ListFilter,
	LogIn,
	LogOut,
	MessageSquare,
	MoreHorizontal,
	Pencil,
	Plug,
	Plus,
	RefreshCw,
	Search,
	Settings as SettingsIcon,
	Spinner,
	SquarePen,
	Sun,
	Trash2,
	Undo,
	Wrench,
} from "./icons.tsx";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
	SelectMenu,
} from "./menu.tsx";
import { NavRow } from "./nav-row.tsx";
import { Popover } from "./popover.tsx";
import { SidebarFrame } from "./sidebar.tsx";
import { DeleteThreadDialog } from "./thread-actions.tsx";
import { Switch } from "./switch.tsx";
import { Tooltip } from "./tooltip.tsx";

declare global {
	interface Window {
		/** Chromium's Local Font Access, which lists the installed fonts (not in TypeScript's DOM types yet). */
		queryLocalFonts(): Promise<{ family: string; style: string; postscriptName: string }[]>;
	}
}

export const SETTINGS_PAGES: { page: SettingsPage; label: string; icon: ReactNode; group: string }[] = [
	{ page: "general", label: "General", icon: <SettingsIcon size={16} />, group: "Personal" },
	{ page: "appearance", label: "Appearance", icon: <Sun size={16} />, group: "Personal" },
	{ page: "models", label: "Models & accounts", icon: <CircleUserRound size={16} />, group: "Personal" },
	{ page: "archived", label: "Archived threads", icon: <Archive size={16} />, group: "Personal" },
	{ page: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={16} />, group: "Personal" },
	{ page: "about", label: "About", icon: <Info size={16} />, group: "Personal" },
	{ page: "configuration", label: "Configuration", icon: <Code size={16} />, group: "Coding" },
	{ page: "tools", label: "Tools", icon: <Wrench size={16} />, group: "Coding" },
	{ page: "mcp", label: "MCP servers", icon: <Globe size={16} />, group: "Coding" },
	{ page: "extensions", label: "Extensions & skills", icon: <Layers size={16} />, group: "Coding" },
	{ page: "plugins", label: "Plugins", icon: <Plug size={16} />, group: "Coding" },
	{ page: "worktrees", label: "Worktrees", icon: <GitBranch size={16} />, group: "Coding" },
];

/** A search field: the nav's 36px pill on a ghost fill, or a page's 32px one on the control fill under a ring. */
function SearchField({
	value,
	onChange,
	placeholder,
	page,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	page?: boolean;
}) {
	return (
		<label
			className={`flex items-center gap-2 rounded-full text-base leading-[18px] ${page ? "h-8 border border-line-strong bg-field px-2.5" : "h-9 bg-ghost-hover px-3"}`}
		>
			<Search size={page ? 18 : 16} className="shrink-0 text-secondary" />
			<input
				value={value}
				aria-label={placeholder}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-tertiary"
			/>
		</label>
	);
}

/** The settings pages, in the sidebar's column while Settings is open. */
export function SettingsNav({ page }: { page: SettingsPage }) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const shown = SETTINGS_PAGES.filter((p) => p.label.toLowerCase().includes(q));
	return (
		<SidebarFrame label="Settings">
			<div className="flex shrink-0 flex-col px-2 pb-2">
				<div className="flex h-[52px] items-center ps-2">
					<h1 className="text-[18px] leading-6 font-semibold">Settings</h1>
				</div>
				<SearchField value={query} onChange={setQuery} placeholder="Search" />
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-1 pb-2">
				{[...new Set(shown.map((p) => p.group))].map((group) => (
					<div key={group} className="flex flex-col gap-1">
						<div className="flex h-[30px] items-center ps-2 pe-1.5 text-base font-medium text-tertiary">{group}</div>
						<div className="flex flex-col gap-px">
							{shown
								.filter((p) => p.group === group)
								.map((p) => (
									<NavRow
										key={p.page}
										icon={p.icon}
										label={p.label}
										current={p.page === page}
										className="text-ink"
										onActivate={() => navigate({ kind: "settings", page: p.page })}
									/>
								))}
						</div>
					</div>
				))}
			</div>
		</SidebarFrame>
	);
}

/**
 * A row: the title (13px medium) over its description (12px, secondary), the control at the end, and what `below`
 * holds under them.
 */
function Row({
	title,
	detail,
	compact,
	below,
	children,
}: {
	title: ReactNode;
	detail?: ReactNode;
	/** Codex's Appearance rows: 8px above and below instead of 12. */
	compact?: boolean;
	below?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="relative not-last:after:absolute not-last:after:inset-x-4 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-line">
			<div className={`flex items-center justify-between gap-6 px-4 ${compact ? "py-2" : "py-3"}`}>
				<div className="flex min-w-0 flex-col gap-0.5">
					<div className="text-sm font-medium [overflow-wrap:anywhere]">{title}</div>
					{detail ? <div className="text-xs [overflow-wrap:anywhere] text-secondary">{detail}</div> : null}
				</div>
				<div className="flex min-w-40 shrink-0 items-center justify-end gap-2">{children}</div>
			</div>
			{below}
		</div>
	);
}

/**
 * A page's search field or tabs, kept in view while the page scrolls (Codex's: 20px over it, 8px under it, then 20px
 * to the content, where sections are 40px apart).
 */
const PageBar = ({ children }: { children: ReactNode }) => (
	<div className="sticky top-0 z-10 -mt-5 -mb-5 bg-surface pt-5 pb-2">{children}</div>
);

/** A section: its heading (14px medium, centred in 40px over 6px), then its cards. */
function Section({ title, aside, children }: { title?: ReactNode; aside?: ReactNode; children: ReactNode }) {
	return (
		<section className="flex flex-col">
			{title ? (
				<div className="flex min-h-11.5 items-center justify-between gap-4 pb-1.5">
					<h2 className="text-base font-medium">{title}</h2>
					{aside}
				</div>
			) : null}
			{/* A section's cards stack 16px apart (Codex's Visual style: Mode, then the theme). */}
			<div className="flex flex-col gap-4">{children}</div>
		</section>
	);
}

/** A card of rows: Codex's settings panel, 20px corners under a hairline. */
const Box = ({ children }: { children: ReactNode }) => (
	<div className="rounded-2xl border border-line bg-section">{children}</div>
);

/** The usual section: a heading over one card. */
const Card = ({ title, aside, children }: { title?: ReactNode; aside?: ReactNode; children: ReactNode }) => (
	<Section title={title} aside={aside}>
		<Box>{children}</Box>
	</Section>
);

function General() {
	const prefs = useStore(selectPreferences);
	const mod = isMac() ? "⌘" : "Ctrl";
	return (
		<>
			<Card title="Permissions">
				<Row
					title="Full access"
					detail="With full access, KnightCode runs commands and edits files without asking. Shows it in the composer's permissions menu."
				>
					<Switch
						label="Show Full access in the composer"
						checked={prefs.allowFullAccess}
						onChange={(v) => setPreference("allowFullAccess", v)}
					/>
				</Row>
			</Card>
			<Card title="General">
				<Row title="Confirm before closing a window" detail="Warn when the close shortcut would close the window">
					<SelectMenu
						label="Confirm before closing a window"
						value={prefs.confirmClose ?? "shortcut"}
						onChange={(v) => setPreference("confirmClose", v)}
						options={[
							{ value: "never", label: "Never" },
							{ value: "shortcut", label: "Close shortcut only" },
							{ value: "always", label: "Always" },
						]}
					/>
				</Row>
				<Row title="Automatically archive inactive threads" detail="Archive threads after a period of inactivity">
					<SelectMenu
						label="Automatically archive inactive threads"
						value={String(prefs.autoArchiveDays ?? 0)}
						onChange={(v) => setPreference("autoArchiveDays", Number(v))}
						options={[
							{ value: "0", label: "Never" },
							...[1, 7, 14, 30, 90].map((d) => ({ value: String(d), label: d === 1 ? "1 day" : `${d} days` })),
						]}
					/>
				</Row>
			</Card>
			<Card title="Composer">
				<Row title="Show context window usage">
					<Switch
						label="Show context window usage in the composer"
						checked={prefs.showContextUsage !== false}
						onChange={(v) => setPreference("showContextUsage", v)}
					/>
				</Row>
				<Row title="Send shortcut" detail="Choose when Enter sends a prompt or inserts a new line">
					<SelectMenu
						label="Send shortcut"
						value={prefs.sendKey}
						onChange={(v) => setPreference("sendKey", v)}
						options={[
							{ value: "enter", label: "Enter" },
							{ value: "modEnter", label: `${mod}+Enter` },
						]}
					/>
				</Row>
				<Row
					title="Follow-up behavior"
					detail={`Queue follow-ups while KnightCode runs or steer the current run. Press ${mod}+Enter to do the opposite for one message`}
				>
					<Segmented
						label="Follow-up behavior"
						value={prefs.whileRunning}
						onChange={(v) => setPreference("whileRunning", v)}
						options={[
							{ value: "queue", label: "Queue" },
							{ value: "steer", label: "Steer" },
						]}
					/>
				</Row>
			</Card>
			<Card title="Notifications">
				<Row title="Turn completion notifications" detail="Set when KnightCode alerts you that it's finished">
					<SelectMenu
						label="Turn completion notifications"
						value={prefs.turnNotifications ?? "unfocused"}
						onChange={(v) => setPreference("turnNotifications", v)}
						options={[
							{ value: "never", label: "Never" },
							{ value: "unfocused", label: "Only when unfocused" },
							{ value: "always", label: "Always" },
						]}
					/>
				</Row>
			</Card>
		</>
	);
}

/** A miniature window in one theme (its tokens scoped to it), as Codex draws its Mode choices: 80 by 60. */
function ThemePreview({ theme, className = "" }: { theme: "light" | "dark"; className?: string }) {
	// Lines of text at [left, top, width], the first and last in the accent (Codex's blue), after Codex's art.
	const lines: [number, number, number, boolean][] = [
		[38, 12, 30, true],
		[24, 18, 30, false],
		[24, 22, 18, false],
		[24, 26, 36, false],
		[29, 32, 39, true],
	];
	return (
		<span data-theme={theme} className={`absolute top-0 h-15 w-20 bg-shell ${className}`}>
			<span className="absolute inset-2 overflow-hidden rounded-xs border border-line-strong bg-surface">
				<span className="absolute inset-y-0 left-0 w-3 border-r border-line bg-sidebar" />
			</span>
			{lines.map(([left, top, width, accent]) => (
				<span
					key={top}
					style={{ left, top, width }}
					className={`absolute h-0.5 rounded-full ${accent ? "bg-current" : "bg-ink/10"}`}
				/>
			))}
			<span className="absolute top-[42px] left-6 h-1.5 w-11 rounded-full border border-line-strong" />
		</span>
	);
}

const MODES = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
] as const;

/**
 * A select on a pill, as Codex's Appearance rows draw theirs (Theme, Accent, Font): 28px, the surface's fill under
 * a hairline, 12px text, a mark before the label and a chevron after it, opening its choices with a check.
 */
function PillMenu({
	label,
	mark,
	text,
	value,
	options,
	onChange,
	disabled,
}: {
	label: string;
	mark?: ReactNode;
	text: string;
	value: string;
	disabled?: boolean;
	options: { value: string; label: string; icon?: ReactNode }[];
	onChange: (value: string) => void;
}) {
	return (
		<Menu>
			<MenuTrigger>
				<Button
					variant="field"
					pill
					aria-label={label}
					disabled={disabled}
					className="max-w-56 gap-1.5 px-2 text-xs [--button-fill:var(--kc-bg-surface)]"
				>
					{mark}
					<span className="truncate">{text}</span>
					<ChevronDown size={14} className="text-tertiary" />
				</Button>
			</MenuTrigger>
			<MenuContent align="end" className="max-h-80 overflow-y-auto">
				<MenuRadioGroup value={value} onValueChange={onChange}>
					{options.map((o) => (
						<MenuRadioItem key={o.value} value={o.value} icon={o.icon}>
							{o.label}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuContent>
		</Menu>
	);
}

/** A colour's dot, as Codex marks its accents and colour fields: the colour under a hairline. */
const Swatch = ({ color, size = 12 }: { color: string; size?: number }) => (
	<span
		style={{ backgroundColor: color, width: size, height: size }}
		className="shrink-0 rounded-full border border-line"
	/>
);

/**
 * A colour, as Codex's Background and Foreground: a 96px pill with the swatch, which opens the system colour picker,
 * and the hex value, applied on Enter or leaving the field (an invalid one reverts).
 */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
	const [text, setText] = useState(value);
	useEffect(() => setText(value), [value]);
	const commit = () => (isHex(text) ? onChange(text.toLowerCase()) : setText(value));
	return (
		<span className="flex h-7 w-24 items-center gap-2 rounded-full border border-line px-2">
			<label className="relative flex">
				<Swatch color={value} size={14} />
				<input
					type="color"
					aria-label={label}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className="absolute inset-0 size-full cursor-pointer opacity-0"
				/>
			</label>
			<input
				aria-label={`${label} hex`}
				value={text.toUpperCase()}
				spellCheck={false}
				onChange={(e) => setText(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => matches(e, "desktop.item.activate") && commit()}
				className="w-14 min-w-0 bg-transparent text-xs leading-4 outline-none focus-visible:outline-none"
			/>
		</span>
	);
}

/** Codex's "Import theme": paste a theme string; Import is enabled once it parses. */
function ImportThemeDialog({ onImport, onClose }: { onImport: (custom: Customization) => void; onClose: () => void }) {
	const [text, setText] = useState("");
	const parsed = parseThemeString(text);
	return (
		<Dialog title="Import theme" onClose={onClose}>
			<div className="pt-3">
				<input
					aria-label="Theme"
					value={text}
					spellCheck={false}
					placeholder='knightcode-theme-v1:{"accent":"#3566f0","background":"#181818"}'
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => parsed && matches(e, "desktop.item.activate") && onImport(parsed)}
					className="kc-input font-code text-xs"
				/>
			</div>
			<DialogActions>
				<Button color="secondary" size="lg" squircle className="px-4" onClick={onClose}>
					Cancel
				</Button>
				<Button
					variant="solid"
					size="lg"
					squircle
					className="px-4"
					disabled={!parsed}
					onClick={() => parsed && onImport(parsed)}
				>
					Import theme
				</Button>
			</DialogActions>
		</Dialog>
	);
}

const ACCENT_OPTIONS = [
	{ value: "default", label: "Default" },
	...ACCENTS.map((a) => ({ value: a.hex, label: a.name })),
	{ value: "custom", label: "Custom" },
];

/**
 * Appearance, as Codex's: the Mode tiles, then the theme's own customization (Codex keeps one per light and dark;
 * these rows edit the one showing): the theme with Import and Copy, Accent (Codex's choices or a custom colour),
 * Background, Foreground and Font.
 */
function Appearance() {
	const prefs = useStore(selectPreferences);
	const theme = useStore((s) => s.resolvedTheme);
	const custom = prefs.appearance?.[theme] ?? {};
	const base = BASE[theme];
	const name = theme === "dark" ? "Dark" : "Light";
	const [importing, setImporting] = useState(false);
	const [fonts, setFonts] = useState<LocalFont[]>([]);
	useEffect(() => {
		// The installed fonts, as Codex lists them (Chromium's Local Font Access); the system font alone if refused.
		// The query can need a user gesture, so a refused one is tried again on the next press (opening a picker).
		let cancelled = false;
		const load = () =>
			window.queryLocalFonts().then(
				(found) => {
					if (!cancelled) setFonts(found);
					return true;
				},
				() => false,
			);
		const retry = () => void load();
		void load().then((ok) => {
			if (!ok && !cancelled) window.addEventListener("pointerdown", retry, { once: true, capture: true });
		});
		return () => {
			cancelled = true;
			window.removeEventListener("pointerdown", retry, { capture: true });
		};
	}, []);
	const accent = custom.accent ?? base.accent;
	const named = ACCENTS.find((a) => a.hex === custom.accent);
	const accentValue = !custom.accent ? "default" : named ? named.hex : "custom";
	const customized = Object.keys(custom).length > 0;
	return (
		<>
			<Section title="Visual style">
				<Box>
					<div className="flex items-center justify-between gap-3 px-4 py-2">
						<span className="text-sm font-medium">Mode</span>
						<div role="radiogroup" aria-label="Mode" className="flex gap-4">
							{MODES.map((m) => (
								<Tooltip key={m.value} content={m.label}>
									<label className="relative block h-15 w-20">
										<input
											type="radio"
											name="mode"
											aria-label={m.label}
											checked={prefs.theme === m.value}
											onChange={() => setPreference("theme", m.value)}
											className="peer sr-only"
										/>
										<span className="absolute inset-0 overflow-hidden rounded-lg text-info">
											{m.value === "system" ? (
												<>
													<span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
														<ThemePreview theme="light" className="left-0" />
													</span>
													<span className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
														<ThemePreview theme="dark" className="right-0" />
													</span>
												</>
											) : (
												<ThemePreview theme={m.value} className="left-0" />
											)}
										</span>
										<span className="pointer-events-none absolute inset-0 rounded-lg border-2 border-line peer-checked:border-[var(--kc-focus)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--kc-focus)]" />
									</label>
								</Tooltip>
							))}
						</div>
					</div>
				</Box>
				<Box>
					<Row compact title="Theme">
						<IconButton label={`Import ${name} theme`} size="lg" round onClick={() => setImporting(true)}>
							<Import size={20} />
						</IconButton>
						<IconButton
							label={`Copy ${name} theme`}
							size="lg"
							round
							onClick={() =>
								void client
									.host("host/clipboard/writeText", { text: themeString(custom) })
									.then(() => toast("Copied theme", "success"))
							}
						>
							<Copy size={20} />
						</IconButton>
						<PillMenu
							label={`${name} theme`}
							mark={
								<span className="flex size-5 items-center justify-center rounded-full border border-line-strong text-xs leading-3 font-semibold text-accent">
									<span className="[text-box:trim-both_cap_alphabetic]">Aa</span>
								</span>
							}
							text={customized ? "Custom" : "KnightCode"}
							value={customized ? "custom" : "knightcode"}
							options={[
								{ value: "knightcode", label: "KnightCode" },
								...(customized ? [{ value: "custom", label: "Custom" }] : []),
							]}
							onChange={(v) => v === "knightcode" && customize(theme, undefined)}
						/>
					</Row>
					<Row compact title="Accent">
						{accentValue === "custom" ? (
							<ColorField
								label={`${name} custom accent color`}
								value={accent}
								onChange={(hex) => customize(theme, { accent: hex })}
							/>
						) : null}
						<PillMenu
							label={`${name} accent color`}
							mark={<Swatch color={accent} />}
							text={ACCENT_OPTIONS.find((o) => o.value === accentValue)!.label}
							value={accentValue}
							options={ACCENT_OPTIONS.map((o) => ({
								...o,
								icon:
									o.value === "custom" ? undefined : <Swatch color={o.value === "default" ? base.accent : o.value} />,
							}))}
							onChange={(v) => customize(theme, { accent: v === "default" ? undefined : v === "custom" ? accent : v })}
						/>
					</Row>
					<Row compact title="Background">
						<ColorField
							label={`${name} background color`}
							value={custom.background ?? base.background}
							onChange={(hex) => customize(theme, { background: hex })}
						/>
					</Row>
					<Row compact title="Foreground">
						<ColorField
							label={`${name} ink color`}
							value={custom.foreground ?? base.foreground}
							onChange={(hex) => customize(theme, { foreground: hex })}
						/>
					</Row>
					<Row compact title="Font">
						<PillMenu
							label={`${name} UI font`}
							text={custom.font ?? "System"}
							value={custom.font ?? "system"}
							options={[
								{ value: "system", label: "System" },
								...[...new Set(fonts.map((f) => f.family))].map((f) => ({ value: f, label: f })),
							]}
							onChange={(v) => customize(theme, { font: v === "system" ? undefined : v, fontStyle: undefined })}
						/>
					</Row>
				</Box>
				{importing ? (
					<ImportThemeDialog
						onClose={() => setImporting(false)}
						onImport={(imported) => {
							setImporting(false);
							customize(theme, imported, true);
						}}
					/>
				) : null}
			</Section>
			<AdvancedAppearance fonts={fonts} />
		</>
	);
}

/**
 * A number, as Codex's Advanced font sizes: a 64px field (96px for large ones) with its unit after it, applied on
 * Enter or leaving it; one out of range reverts.
 */
function SizeField({
	label,
	value,
	min,
	max,
	unit = "px",
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	unit?: string;
	onChange: (px: number) => void;
}) {
	const [text, setText] = useState(String(value));
	useEffect(() => setText(String(value)), [value]);
	const commit = () => {
		// Number("") is 0: a cleared field reverts rather than writing 0.
		const n = text.trim() === "" ? Number.NaN : Math.round(Number(text));
		if (n >= min && n <= max) {
			if (n !== value) onChange(n);
		} else setText(String(value));
	};
	return (
		<span className="flex items-center gap-2 text-sm text-tertiary">
			<input
				type="number"
				aria-label={label}
				min={min}
				max={max}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => matches(e, "desktop.item.activate") && commit()}
				className={`kc-input h-7 border-line-strong px-2 text-ink ${max >= 1000 ? "w-24" : "w-16"}`}
			/>
			{unit}
		</span>
	);
}

type LocalFont = { family: string; style: string; postscriptName: string };

/**
 * Appearance › Advanced, as Codex's (measured 2026-10-19): the UI and code sizes (window-wide); the showing theme's
 * UI font style, content and code fonts with their styles, translucent sidebar and contrast; then diff markers and
 * pointer cursors. A style picks one of the chosen family's faces, so it waits for a family.
 */
function AdvancedAppearance({ fonts }: { fonts: LocalFont[] }) {
	const prefs = useStore(selectPreferences);
	const theme = useStore((s) => s.resolvedTheme);
	const custom = prefs.appearance?.[theme] ?? {};
	const name = theme === "dark" ? "Dark" : "Light";
	const [open, setOpen] = useState(false);
	const families = [...new Set(fonts.map((f) => f.family))];
	const familyOptions = families.map((f) => ({ value: f, label: f }));
	const contrast = custom.contrast ?? DEFAULT_CONTRAST;
	const styleMenu = (
		label: string,
		family: string | undefined,
		face: string | undefined,
		key: "fontStyle" | "contentFontStyle" | "codeFontStyle",
	) => {
		const faces = fonts.filter((f) => f.family === family);
		return (
			<PillMenu
				label={`${name} ${label}`}
				disabled={!family}
				text={faces.find((f) => f.postscriptName === face)?.style ?? "Regular"}
				value={face ?? ""}
				options={faces.map((f) => ({ value: f.postscriptName, label: f.style }))}
				onChange={(v) => customize(theme, { [key]: v })}
			/>
		);
	};
	return (
		<section className="flex flex-col">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex min-h-11.5 w-fit items-center gap-1 pb-1.5 text-base font-medium text-tertiary hover:text-ink"
			>
				Advanced
				<ChevronRight
					size={14}
					className={`transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
				/>
			</button>
			{open ? (
				<div className="flex flex-col gap-4">
					<Box>
						<Row title="UI font size" detail="Adjust the base size used for KnightCode">
							<SizeField
								label="UI font size"
								value={prefs.uiFontSize ?? 14}
								min={11}
								max={16}
								onChange={(px) => setPreference("uiFontSize", px === 14 ? undefined : px)}
							/>
						</Row>
						<Row title="Code font size" detail="Adjust the base size used for code across threads and diffs">
							<SizeField
								label="Code font size"
								value={prefs.codeFontSize ?? 12}
								min={10}
								max={16}
								onChange={(px) => setPreference("codeFontSize", px === 12 ? undefined : px)}
							/>
						</Row>
					</Box>
					<Box>
						<Row compact title="UI font style">
							{styleMenu("UI font style", custom.font, custom.fontStyle, "fontStyle")}
						</Row>
						<Row compact title="Content font">
							<PillMenu
								label={`${name} content font`}
								text={custom.contentFont ?? "Same as UI font"}
								value={custom.contentFont ?? "ui"}
								options={[{ value: "ui", label: "Same as UI font" }, ...familyOptions]}
								onChange={(v) =>
									customize(theme, { contentFont: v === "ui" ? undefined : v, contentFontStyle: undefined })
								}
							/>
							{styleMenu("content font style", custom.contentFont, custom.contentFontStyle, "contentFontStyle")}
						</Row>
						<Row compact title="Code font">
							<PillMenu
								label={`${name} code font`}
								text={custom.codeFont ?? "System"}
								value={custom.codeFont ?? "system"}
								options={[{ value: "system", label: "System" }, ...familyOptions]}
								onChange={(v) =>
									customize(theme, { codeFont: v === "system" ? undefined : v, codeFontStyle: undefined })
								}
							/>
							{styleMenu("code font style", custom.codeFont, custom.codeFontStyle, "codeFontStyle")}
						</Row>
						<Row compact title="Translucent sidebar">
							<Switch
								label={`${name} translucent sidebar`}
								checked={custom.translucentSidebar === true}
								onChange={(on) => customize(theme, { translucentSidebar: on || undefined })}
							/>
						</Row>
						<Row compact title="Contrast">
							<input
								type="range"
								aria-label={`${name} contrast`}
								min={0}
								max={100}
								step={1}
								value={contrast}
								style={{ "--kc-range-fill": `${contrast}%` } as CSSProperties}
								onChange={(e) => {
									const v = Number(e.target.value);
									customize(theme, { contrast: v === DEFAULT_CONTRAST ? undefined : v });
								}}
								className="kc-range w-36"
							/>
							<span className="w-8 text-end text-sm tabular-nums">{contrast}</span>
						</Row>
					</Box>
					<Box>
						<Row title="Diff markers" detail="Show changes using colors or +/− markers">
							<Segmented
								label="Diff markers"
								value={prefs.diffMarkers ?? "color"}
								onChange={(v) => setPreference("diffMarkers", v === "color" ? undefined : v)}
								options={[
									{ value: "color", label: "Color" },
									{ value: "plusMinus", label: "+/−" },
								]}
							/>
						</Row>
						<Row
							title="Use pointer cursors"
							detail="Change the cursor to a pointer when hovering over interactive elements"
						>
							<Switch
								label="Use pointer cursors"
								checked={prefs.pointerCursors === true}
								onChange={(on) => setPreference("pointerCursors", on || undefined)}
							/>
						</Row>
					</Box>
				</div>
			) : null}
		</section>
	);
}

/** One sign-in flow, under its provider's row: links and codes to act on, and the prompt the provider is waiting for. */
function LoginFlow({ loginId, onDone }: { loginId: string; onDone: () => void }) {
	const login: LoginState | undefined = useStore((s) => s.logins[loginId]);
	const [value, setValue] = useState("");
	useEffect(() => {
		if (login?.status === "complete") onDone();
	}, [login?.status, onDone]);
	if (!login) return <div className="kc-pulse px-4 pb-3 text-sm text-secondary">Starting sign-in…</div>;
	const prompt = login.status === "pending" ? login.pendingPrompt : undefined;
	const submit = (answer: string) => {
		setValue("");
		if (prompt) void answerLogin(loginId, answer);
	};
	const open = (url: string) => void client.host("host/shell/openExternal", { url });
	return (
		<div className="flex flex-col items-start gap-3 px-4 pb-3 text-sm">
			{login.events.map((event, i) => {
				const e = event as {
					type?: string;
					url?: string;
					instructions?: string;
					userCode?: string;
					verificationUri?: string;
					message?: string;
					links?: { url: string; label?: string }[];
				};
				if (e.type === "info" && e.links?.length)
					return (
						<div key={i} className="flex flex-col items-start gap-1.5">
							<div className="text-secondary">{e.message}</div>
							{e.links.map((link) => (
								<Button key={link.url} variant="soft" toolbar onClick={() => open(link.url)}>
									<ExternalLink size={16} /> {link.label ?? link.url}
								</Button>
							))}
						</div>
					);
				if (e.type === "auth_url" && e.url)
					return (
						<div key={i} className="flex flex-col items-start gap-1.5">
							{e.instructions ? <div className="text-secondary">{e.instructions}</div> : null}
							<Button variant="solid" toolbar onClick={() => open(e.url!)}>
								<ExternalLink size={16} /> Open the sign-in page
							</Button>
						</div>
					);
				if (e.type === "device_code")
					return (
						<div key={i} className="flex flex-col items-start gap-1.5">
							<div className="text-secondary">Enter this code at the sign-in page:</div>
							<div className="selectable font-code text-lg tracking-widest">{e.userCode}</div>
							{e.verificationUri ? (
								<Button variant="soft" toolbar onClick={() => open(e.verificationUri!)}>
									<ExternalLink size={16} /> Open {e.verificationUri}
								</Button>
							) : null}
						</div>
					);
				return e.message ? (
					<div key={i} className="text-secondary">
						{e.message}
					</div>
				) : null;
			})}
			{prompt ? (
				<div className="flex w-full flex-col gap-2">
					<div>{prompt.prompt.message}</div>
					{prompt.prompt.options ? (
						<div className="flex flex-col gap-1">
							{prompt.prompt.options.map((o) => (
								<button
									key={o.id}
									type="button"
									onClick={() => submit(o.id)}
									className="rounded-lg border border-line px-3 py-2 text-start hover:bg-ghost-hover"
								>
									<div>{o.label}</div>
									{o.description ? <div className="text-xs text-secondary">{o.description}</div> : null}
								</button>
							))}
						</div>
					) : (
						<div className="flex gap-2">
							<input
								autoFocus
								type={prompt.prompt.type === "secret" ? "password" : "text"}
								value={value}
								aria-label={prompt.prompt.message}
								placeholder={prompt.prompt.placeholder}
								onChange={(e) => setValue(e.target.value)}
								onKeyDown={(e) => matches(e, "desktop.composer.send") && submit(value)}
								className="kc-input h-7 flex-1 border-line-strong px-2"
							/>
							<Button variant="solid" toolbar onClick={() => submit(value)}>
								Continue
							</Button>
						</div>
					)}
				</div>
			) : null}
			{login.status === "failed" ? (
				<>
					<div className="text-danger-text">{login.error}</div>
					<Button variant="soft" toolbar onClick={onDone}>
						Dismiss
					</Button>
				</>
			) : null}
			{login.status === "pending" ? (
				<Button variant="soft" toolbar onClick={() => void cancelLogin(loginId).then(onDone)}>
					Cancel
				</Button>
			) : null}
		</div>
	);
}

/** The default model: a select-style button opening the composer's searchable model list. */
function DefaultModel() {
	const models = useStore((s) => s.models);
	const defaultModel = useStore((s) => s.defaultModel);
	const model = models.find((m) => `${m.provider}/${m.id}` === defaultModel);
	return (
		<Popover
			side="bottom"
			align="end"
			trigger={(open) => (
				<Button variant="field" toolbar aria-expanded={open} aria-label="Default model" className="max-w-64 px-3">
					<span className="truncate">{model ? `${model.providerName} · ${model.name}` : "Choose a model"}</span>
					<ChevronDown size={14} className="text-tertiary" />
				</Button>
			)}
		>
			{(close) => (
				<ModelList
					model={model}
					onModel={(m) => {
						close();
						void setDefaultModel(m);
					}}
				/>
			)}
		</Popover>
	);
}

function Models() {
	const accounts = useStore((s) => s.accounts);
	const [active, setActive] = useState<{ key: string; loginId?: string } | undefined>();
	useEffect(() => void refreshAccounts(), []);
	const signedIn = new Set(accounts?.accounts.map((a) => `${a.provider}:${a.type}`));
	return (
		<>
			<Card title="Default model">
				<Row title="New threads use" detail="Shared with the terminal (settings.json)">
					<DefaultModel />
				</Row>
			</Card>
			<Card title="Accounts">
				{accounts?.accounts.length ? null : <Row title="Not signed in to any provider" />}
				{accounts?.accounts.map((a) => (
					<Row
						key={`${a.provider}:${a.type}`}
						title={a.providerName}
						detail={a.type === "oauth" ? (a.isSubscription ? "Subscription" : "Signed in") : "API key"}
					>
						<Button variant="soft" toolbar onClick={() => void logout(a.provider)}>
							<LogOut size={16} /> Sign out
						</Button>
					</Row>
				))}
			</Card>
			<Card title="Add an account">
				{accounts?.loginOptions.map((o) => {
					const key = `${o.provider}:${o.type}`;
					const open = active?.key === key;
					return (
						<div
							key={key}
							className="relative not-last:after:absolute not-last:after:inset-x-4 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-line"
						>
							<Row title={o.providerName} detail={o.label}>
								{signedIn.has(key) ? (
									<span className="flex items-center gap-1 text-sm text-success">
										<Check size={16} /> Signed in
									</span>
								) : open ? null : (
									<Button
										variant="soft"
										toolbar
										onClick={() => {
											setActive({ key });
											void startLogin(o.provider, o.type).then((loginId) =>
												loginId ? setActive({ key, loginId }) : setActive(undefined),
											);
										}}
									>
										{o.type === "api_key" ? <KeyRound size={16} /> : <LogIn size={16} />}
										{o.type === "api_key" ? "Add key" : "Sign in"}
									</Button>
								)}
							</Row>
							{open && active.loginId ? (
								<LoginFlow loginId={active.loginId} onDone={() => setActive(undefined)} />
							) : null}
						</div>
					);
				})}
			</Card>
		</>
	);
}

/** A page's tabs, as Codex's Worktrees page: 13px medium labels, the current one on the surface's darker fill. */
function Tabs<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="tablist" aria-label={label} className="flex gap-0.5">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="tab"
					aria-selected={o.value === value}
					onClick={() => onChange(o.value)}
					className="rounded-md px-2 py-1 text-sm font-medium text-secondary hover:text-ink aria-selected:bg-surface-secondary aria-selected:text-ink"
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

type WorktreeSettings = { autoDelete?: boolean; keep?: number; fetchBeforeCreate?: boolean; branchPrefix?: string };
type WorktreeRow = ResultOf<"worktree/list">["worktrees"][number];

/**
 * Worktrees, as Codex's page: General (settings.json, shared with the terminal, then the managed worktrees by project,
 * each with the threads that used it) and Environments (each project's setup scripts).
 */
function Worktrees() {
	const [tab, setTab] = useState<"general" | "environments">("general");
	return (
		<>
			<PageBar>
				<Tabs
					label="Worktrees settings"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "general", label: "General" },
						{ value: "environments", label: "Environments" },
					]}
				/>
			</PageBar>
			{tab === "general" ? <WorktreeGeneral /> : <Environments />}
		</>
	);
}

function WorktreeGeneral() {
	const threads = useStore((s) => s.threads);
	const [settings, setSettings] = useState<WorktreeSettings>({});
	const [worktrees, setWorktrees] = useState<WorktreeRow[]>([]);
	const reload = () => {
		void client
			.request("config/read", {})
			.then((r) => setSettings(((r.settings as { worktrees?: WorktreeSettings }).worktrees ?? {}) as WorktreeSettings));
		void client.request("worktree/list", {}).then((r) => setWorktrees(r.worktrees.filter((w) => !w.deleted)));
	};
	useEffect(reload, []);
	const write = (key: keyof WorktreeSettings, value: unknown) =>
		void client
			.request("config/write", { scope: "global", key: `worktrees.${key}`, value })
			.then(() => setSettings((s) => ({ ...s, [key]: value })))
			.catch((e: unknown) => toast(errorText(e), "error"));
	const byProject = new Map<string, WorktreeRow[]>();
	for (const w of worktrees) byProject.set(w.projectCwd, [...(byProject.get(w.projectCwd) ?? []), w]);
	return (
		<>
			<Card>
				<Row title="Branch prefix" detail="Branches made for a worktree's changes start with this">
					<input
						aria-label="Branch prefix"
						defaultValue={settings.branchPrefix ?? "kc/"}
						key={settings.branchPrefix}
						onBlur={(e) => e.target.value !== (settings.branchPrefix ?? "kc/") && write("branchPrefix", e.target.value)}
						className="kc-input w-72 border-line-strong"
					/>
				</Row>
				<Row
					title="Always fetch upstream before creating worktrees"
					detail="Fetch the base branch's remote before each new worktree"
				>
					<Switch
						label="Always fetch upstream before creating worktrees"
						checked={settings.fetchBeforeCreate ?? false}
						onChange={(v) => write("fetchBeforeCreate", v)}
					/>
				</Row>
				<Row
					title="Automatically delete old worktrees"
					detail="Archiving a thread deletes its worktree, and the oldest past the limit are pruned; a snapshot is kept"
				>
					<Switch
						label="Automatically delete old worktrees"
						checked={settings.autoDelete ?? true}
						onChange={(v) => write("autoDelete", v)}
					/>
				</Row>
				<Row title="Auto-delete limit" detail="Number of managed worktrees to keep before older ones are pruned">
					<input
						type="number"
						min={1}
						aria-label="Auto-delete limit"
						defaultValue={settings.keep ?? 15}
						key={settings.keep}
						onBlur={(e) => {
							const n = Math.floor(Number(e.target.value));
							if (n >= 1 && n !== (settings.keep ?? 15)) write("keep", n);
						}}
						className="kc-input h-7 w-24 border-line-strong px-2"
					/>
				</Row>
			</Card>
			{[...byProject].map(([projectCwd, list]) => (
				<Card
					key={projectCwd}
					title={<span className="text-sm">{projectCwd}</span>}
					aside={
						<IconButton label="Refresh" toolbar onClick={reload}>
							<RefreshCw size={16} />
						</IconButton>
					}
				>
					{list.map((w) => {
						const used = w.threadIds.map((id) => threads.find((t) => t.id === id)).filter((t) => t !== undefined);
						return (
							<div key={w.path} className="flex flex-col gap-2 p-3 not-last:border-b not-last:border-line">
								<div className="flex items-start justify-between gap-3">
									<div className="flex min-w-0 flex-col">
										<div className="text-sm font-medium">{w.branch ?? w.head?.slice(0, 7) ?? "Detached"}</div>
										<div className="selectable text-xs [overflow-wrap:anywhere] text-secondary">{w.path}</div>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										{/* The server files a thread started inside a managed worktree under its project. */}
										<Button variant="soft" toolbar onClick={() => showNew(w.path)}>
											<SquarePen size={16} /> New thread in this worktree
										</Button>
										<Button
											variant="soft"
											color="danger"
											toolbar
											onClick={() =>
												void client
													.request("worktree/delete", { path: w.path })
													.then(reload)
													.catch((e: unknown) => toast(errorText(e), "error"))
											}
										>
											Delete
										</Button>
									</div>
								</div>
								{used.length ? (
									<div className="flex flex-col gap-1">
										<div className="text-xs text-secondary">Known threads</div>
										{used.map((t) => (
											<NavRow
												key={t.id}
												label={t.name || "Untitled"}
												className="text-sm"
												onActivate={() => void openThread(t.id)}
											/>
										))}
									</div>
								) : null}
							</div>
						);
					})}
				</Card>
			))}
		</>
	);
}

/** Each project's local environments: a name and a setup script that runs in every new worktree. */
function Environments() {
	const projects = useStore(selectProjects);
	const [project, setProject] = useState(projects[0]?.path);
	// Rows carry a stable key: the inputs are uncontrolled, so an index key would show a removed row's text in the next.
	const [rows, setRows] = useState<{ key: number; env: Environment }[]>([]);
	const nextKey = useRef(0);
	const keyed = (env: Environment) => ({ key: nextKey.current++, env });
	const [trusted, setTrusted] = useState(true);
	// The project whose rows are showing: nothing saves until they loaded, so one project's scripts never land in another.
	const [loadedFor, setLoadedFor] = useState<string>();
	useEffect(() => {
		setRows([]);
		setLoadedFor(undefined);
		if (!project) return;
		let current = true;
		void client
			.request("environment/list", { cwd: project })
			.then((r) => {
				if (!current) return;
				setRows(r.environments.map(keyed));
				setTrusted(r.trusted);
				setLoadedFor(project);
			})
			.catch((e: unknown) => toast(errorText(e), "error"));
		return () => {
			current = false;
		};
	}, [project]);
	const save = (next: { key: number; env: Environment }[]) => {
		if (!project || loadedFor !== project) return;
		setRows(next);
		if (project)
			void client
				.request("environment/save", {
					cwd: project,
					environments: next.map((r) => r.env).filter((e) => e.name.trim()),
				})
				.catch((e: unknown) => toast(errorText(e), "error"));
	};
	return (
		<Card
			title="Local environments"
			aside={
				<Button
					variant="soft"
					toolbar
					disabled={!project || loadedFor !== project}
					onClick={() => setRows([...rows, keyed({ name: "" })])}
				>
					<Plus size={16} /> Add environment
				</Button>
			}
		>
			<Row
				title="Project"
				detail={trusted ? "Setup runs in each new worktree" : "Trust this project to run its setup scripts"}
			>
				<SelectMenu
					label="Project"
					value={project}
					onChange={setProject}
					options={projects.map((p) => ({ value: p.path, label: basename(p.path) }))}
				/>
			</Row>
			{rows.map(({ key, env }, i) => (
				<div
					key={key}
					className="relative flex flex-col gap-2 px-4 py-3 not-last:after:absolute not-last:after:inset-x-4 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-line"
				>
					<div className="flex gap-2">
						<input
							aria-label="Environment name"
							defaultValue={env.name}
							placeholder="Name"
							onBlur={(e) =>
								save(rows.map((x, j) => (j === i ? { key: x.key, env: { ...x.env, name: e.target.value } } : x)))
							}
							className="kc-input h-7 flex-1 border-line-strong px-2"
						/>
						<Button variant="soft" color="danger" toolbar onClick={() => save(rows.filter((_, j) => j !== i))}>
							Remove
						</Button>
					</div>
					<textarea
						aria-label="Setup script"
						defaultValue={env.setup?.default ?? ""}
						placeholder="Setup script (runs in the new worktree)"
						onBlur={(e) =>
							save(
								rows.map((x, j) =>
									j === i ? { key: x.key, env: { ...x.env, setup: { ...x.env.setup, default: e.target.value } } } : x,
								),
							)
						}
						className="kc-input h-20 resize-y py-2 font-code text-xs leading-4 border-line-strong"
					/>
				</div>
			))}
		</Card>
	);
}

/** Codex's key chip: 20px, 10px corners, 12px, the text colour at 6.5%. */
const KeyChip = ({ keys }: { keys: string }) => (
	<kbd className="rounded-md bg-ink/[0.065] px-2 py-1 font-ui text-xs leading-3 text-secondary">{keyLabel(keys)}</kbd>
);

/**
 * Recording a shortcut, as Codex's: a 144px field reading "Press shortcut" with the focus ring, and Cancel. The next
 * key press (not a lone modifier) is the shortcut; Escape cancels. Keys stop here, so no other shortcut runs.
 */
function ShortcutCapture({
	label,
	onKeys,
	onCancel,
}: {
	label: string;
	onKeys: (keys: string) => void;
	onCancel: () => void;
}) {
	return (
		<span className="flex items-center gap-2">
			<input
				autoFocus
				readOnly
				aria-label={`Shortcut capture for ${label}`}
				value="Press shortcut"
				onKeyDown={(e) => {
					e.preventDefault();
					e.stopPropagation();
					if (matches(e, "desktop.picker.dismiss")) return onCancel();
					const keys = comboFromEvent(e, isMac());
					if (keys) onKeys(keys);
				}}
				onBlur={onCancel}
				className="kc-input h-7 w-36 cursor-default border-[var(--kc-focus)] px-2 text-sm"
			/>
			<Button color="secondary" toolbar onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
				Cancel
			</Button>
		</span>
	);
}

/**
 * One shortcut's row, as Codex's: each of its key combinations as a chip with Change, and Clear at the row's end;
 * "Unassigned" with Change when it has none; Reset when it differs from the default.
 */
function ShortcutRow({ id }: { id: KeybindingId }) {
	const binding = DESKTOP_KEYBINDINGS[id];
	// Read through the store so the row redraws when the rebinding changes.
	const rebound = useStore((s) => selectPreferences(s).keybindings?.[id]);
	const keys = rebound ?? binding.defaultKeys;
	/** The combination being recorded: an index into keys, or keys.length for a new one. */
	const [recording, setRecording] = useState<number>();
	const save = (next: string[]) => {
		setRecording(undefined);
		setKeybinding(id, next);
	};
	const slots = keys.length ? keys.map((k, i) => ({ keys: k, i })) : [{ keys: undefined, i: 0 }];
	return (
		<Row title={binding.description}>
			<span className="flex min-w-96 flex-col">
				{slots.map(({ keys: combo, i }) => (
					<span key={i} role="group" className="flex h-8 items-center justify-between gap-2">
						<span className="flex items-center gap-1">
							{recording === i ? (
								<ShortcutCapture
									label={binding.description}
									onCancel={() => setRecording(undefined)}
									onKeys={(k) => save([...keys.slice(0, i), k, ...keys.slice(i + 1)])}
								/>
							) : (
								<>
									{combo ? <KeyChip keys={combo} /> : <span className="text-sm text-secondary">Unassigned</span>}
									<IconButton
										label={`Change shortcut for ${binding.description}`}
										toolbar
										onClick={() => setRecording(i)}
									>
										<Pencil size={16} />
									</IconButton>
								</>
							)}
						</span>
						<span className="flex items-center gap-1">
							{rebound && i === 0 ? (
								<Button color="secondary" toolbar onClick={() => save([...binding.defaultKeys])}>
									Reset
								</Button>
							) : null}
							{combo ? (
								<IconButton
									label={`Clear shortcut for ${binding.description}`}
									toolbar
									onClick={() => save(keys.filter((_, j) => j !== i))}
								>
									<Trash2 size={16} />
								</IconButton>
							) : null}
						</span>
					</span>
				))}
			</span>
		</Row>
	);
}

function Shortcuts() {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	return (
		<>
			<PageBar>
				<SearchField page value={query} onChange={setQuery} placeholder="Search keyboard shortcuts" />
			</PageBar>
			<Card>
				{(Object.keys(DESKTOP_KEYBINDINGS) as KeybindingId[])
					.filter((id) => DESKTOP_KEYBINDINGS[id].description.toLowerCase().includes(q))
					.map((id) => (
						<ShortcutRow key={id} id={id} />
					))}
			</Card>
		</>
	);
}

/** A filter in a page's bar (Codex's): a select-style button with an icon and the current choice, opening its groups. */
function FilterMenu({
	label,
	icon,
	text,
	className = "",
	groups,
}: {
	label: string;
	icon: ReactNode;
	text: string;
	className?: string;
	groups: {
		value: string;
		onChange: (value: string) => void;
		options: { value: string; label: string; icon?: ReactNode }[];
	}[];
}) {
	return (
		<Menu>
			<MenuTrigger>
				<Button variant="field" toolbar aria-label={label} className={`justify-between px-3 ${className}`}>
					<span className="flex min-w-0 items-center gap-1.5">
						{icon}
						<span className="truncate">{text}</span>
					</span>
					<ChevronDown size={14} className="text-tertiary" />
				</Button>
			</MenuTrigger>
			<MenuContent align="end">
				{groups.map((group, i) => (
					<Fragment key={i}>
						{i > 0 ? <MenuSeparator /> : null}
						<MenuRadioGroup value={group.value} onValueChange={group.onChange}>
							{group.options.map((o) => (
								<MenuRadioItem key={o.value} value={o.value} icon={o.icon}>
									{o.label}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</Fragment>
				))}
			</MenuContent>
		</Menu>
	);
}

const KINDS: { value: ArchiveKind; label: string }[] = [
	{ value: "all", label: "All threads" },
	{ value: "local", label: "Local" },
	{ value: "worktree", label: "Worktree" },
];
const SORTS: { value: ArchiveSort; label: string }[] = [
	{ value: "updated", label: "Updated" },
	{ value: "created", label: "Created" },
	{ value: "name", label: "Alphabetical" },
];

/**
 * Archived threads, as Codex's Archived chats: Delete all beside the title; search, a kind-and-order filter and a
 * project filter in the bar; the threads grouped by project, each with Delete and Unarchive.
 */
function Archived({ title }: { title: string }) {
	const projects = useStore(selectProjects);
	const [threads, setThreads] = useState<ThreadSummary[] | undefined>();
	const [filter, setFilter] = useState<ArchiveFilter>({ query: "", kind: "all", sort: "updated", project: "all" });
	const [deleting, setDeleting] = useState<ThreadSummary | "all">();
	const load = useCallback(() => {
		listArchived()
			.then(setThreads)
			.catch((e: unknown) => toast(errorText(e), "error"));
	}, []);
	// Archiving elsewhere (the sidebar, another window) changes the live list; reread then.
	// Ids only: a status or name change replaces the list, and must not reread the whole archive.
	const live = useStore((s) => s.threads.map((t) => t.id).join("\n"));
	useEffect(load, [load, live]);
	const change = (patch: Partial<ArchiveFilter>) => setFilter((f) => ({ ...f, ...patch }));
	const groups = filterArchived(threads ?? [], filter, projects, samePath, basename);
	const projectText =
		filter.project === "all" ? "All projects" : filter.project === "none" ? NO_PROJECT : basename(filter.project);
	return (
		<>
			<PageHeader
				title={title}
				actions={
					threads?.length ? (
						<Button
							variant="soft"
							color="danger"
							size="lg"
							toolbar
							className="text-sm"
							onClick={() => setDeleting("all")}
						>
							<Trash2 size={16} /> Delete all
						</Button>
					) : null
				}
			/>
			<PageBody>
				<PageBar>
					<div className="flex items-center gap-2">
						<div className="min-w-0 flex-1">
							<SearchField
								page
								value={filter.query}
								onChange={(query) => change({ query })}
								placeholder="Search archived threads"
							/>
						</div>
						<FilterMenu
							label="Filter archived threads"
							icon={<ListFilter size={16} />}
							text={KINDS.find((k) => k.value === filter.kind)!.label}
							className="w-36"
							groups={[
								{ value: filter.kind, onChange: (v) => change({ kind: v as ArchiveKind }), options: KINDS },
								{ value: filter.sort, onChange: (v) => change({ sort: v as ArchiveSort }), options: SORTS },
							]}
						/>
						<FilterMenu
							label="Filter archived threads by project"
							icon={<Folder size={16} />}
							text={projectText}
							className="w-44"
							groups={[
								{
									value: filter.project,
									onChange: (v) => change({ project: v }),
									options: [{ value: "all", label: "All projects" }],
								},
								{
									value: filter.project,
									onChange: (v) => change({ project: v }),
									options: [
										...projects.map((p) => ({
											value: p.path,
											label: p.name ?? basename(p.path),
											icon: <Folder size={16} />,
										})),
										{ value: "none", label: NO_PROJECT, icon: <MessageSquare size={16} /> },
									],
								},
							]}
						/>
					</div>
				</PageBar>
				{threads === undefined ? <div className="kc-pulse text-tertiary">Loading…</div> : null}
				{threads?.length === 0 ? <div className="text-secondary">No archived threads.</div> : null}
				{threads !== undefined && threads.length > 0 && groups.length === 0 ? (
					<div className="text-secondary">No archived threads match.</div>
				) : null}
				{groups.map(([name, list]) => (
					<Card
						key={name}
						title={
							<span className="flex items-center gap-2">
								<Folder size={16} />
								{name}
							</span>
						}
						aside={
							<span className="text-sm text-secondary">
								{list.length} {list.length === 1 ? "thread" : "threads"}
							</span>
						}
					>
						{list.map((t) => (
							<Row
								key={t.id}
								title={t.name || "Untitled"}
								detail={new Date(t.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
							>
								<IconButton label="Delete archived thread" toolbar onClick={() => setDeleting(t)}>
									<Trash2 size={16} />
								</IconButton>
								<Button variant="soft" toolbar onClick={() => void unarchive(t.id).then(load)}>
									Unarchive
								</Button>
							</Row>
						))}
					</Card>
				))}
			</PageBody>
			{deleting === "all" ? (
				<ConfirmDialog
					title="Delete all archived threads?"
					description="This permanently deletes every archived thread."
					confirm="Delete"
					onConfirm={() =>
						void (async () => {
							for (const t of threads ?? []) await deleteThread(t.id);
							load();
						})()
					}
					onClose={() => setDeleting(undefined)}
				/>
			) : deleting ? (
				<DeleteThreadDialog thread={deleting} onDeleted={load} onClose={() => setDeleting(undefined)} />
			) : null}
		</>
	);
}

/**
 * A settings.json key as a row: its control over the value in effect (the default when unset), and a reset once the
 * scope being edited sets it. Configuration, Tools and Terminal are lists of these.
 */
type Field = {
	key: string;
	title: string;
	detail?: string;
	/** Read from the user's settings.json only, so a project's page leaves it out. */
	userOnly?: boolean;
	/** What an unset key means where the server's defaults do not say. */
	fallback?: unknown;
} & (
	| { kind: "switch" }
	| { kind: "select"; options: [value: unknown, label: string][] }
	| { kind: "number"; min: number; max: number; unit: string }
);

/** The value at a dotted key. */
const at = (value: unknown, key: string): unknown =>
	key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], value);

type SettingsFile = {
	read: ResultOf<"config/read">;
	/** The project whose settings.json this edits; the user's when unset. */
	cwd: string | undefined;
	write: (key: string, value: unknown) => Promise<void>;
};

/** One scope's settings, shared with the terminal: each write rereads, so rows show what landed. */
function useSettingsFile(cwd: string | undefined, trusted?: boolean): SettingsFile | undefined {
	// Each result keeps the scope it was read for, and only the newest request lands: after a scope switch, the old
	// scope's values never show (or get written) under the new one.
	const [loaded, setLoaded] = useState<{ cwd: string | undefined; read: ResultOf<"config/read"> }>();
	const latest = useRef(0);
	// A project's own file is read once it is trusted, so trusting it rereads.
	const load = useCallback(() => {
		const request = ++latest.current;
		client
			.request("config/read", cwd === undefined ? {} : { cwd })
			.then((read) => {
				if (request === latest.current) setLoaded({ cwd, read });
			})
			.catch((e: unknown) => toast(errorText(e), "error"));
	}, [cwd, trusted]);
	useEffect(load, [load]);
	if (!loaded || loaded.cwd !== cwd) return undefined;
	const { read } = loaded;
	const write = (key: string, value: unknown) =>
		client
			.request(
				"config/write",
				cwd === undefined ? { scope: "global", key, value } : { scope: "project", cwd, key, value },
			)
			.then(load)
			.catch((e: unknown) => toast(errorText(e), "error"));
	return { read, cwd, write };
}

function FieldRow({ field, file }: { field: Field; file: SettingsFile }) {
	const { read, cwd, write } = file;
	const value = at(read.settings, field.key) ?? at(read.defaults, field.key) ?? field.fallback;
	const setHere = read.origins[field.key] === (cwd === undefined ? "global" : "project");
	let control: ReactNode;
	if (field.kind === "switch")
		control = <Switch label={field.title} checked={value === true} onChange={(on) => write(field.key, on)} />;
	else if (field.kind === "number")
		control = (
			<SizeField
				label={field.title}
				value={Number(value ?? 0)}
				min={field.min}
				max={field.max}
				unit={field.unit}
				onChange={(n) => write(field.key, n)}
			/>
		);
	else {
		// A value the choices lack (a hand-edited one) still shows as itself.
		const known = field.options.some(([option]) => JSON.stringify(option) === JSON.stringify(value));
		const options: [unknown, string][] =
			known || value === undefined ? field.options : [...field.options, [value, String(value)]];
		control = (
			<SelectMenu
				label={field.title}
				value={JSON.stringify(value)}
				onChange={(v) => write(field.key, JSON.parse(v))}
				options={options.map(([option, label]) => ({ value: JSON.stringify(option), label }))}
			/>
		);
	}
	return (
		<Row title={field.title} detail={field.detail}>
			{setHere ? (
				<IconButton
					label={cwd === undefined ? "Reset to default" : "Use the user setting"}
					toolbar
					onClick={() => write(field.key, null)}
				>
					<Undo size={16} />
				</IconButton>
			) : null}
			{control}
		</Row>
	);
}

/** Sections of fields as cards; a project's page leaves out what only the user's file sets. */
function FieldSections({ sections, file }: { sections: [title: string, fields: Field[]][]; file: SettingsFile }) {
	return (
		<>
			{sections.map(([title, fields]) => {
				const shown = fields.filter((f) => file.cwd === undefined || !f.userOnly);
				return shown.length ? (
					<Card key={title} title={title}>
						{shown.map((f) => (
							<FieldRow key={f.key} field={f} file={file} />
						))}
					</Card>
				) : null;
			})}
		</>
	);
}

/** A project's trust decision, the one `/trust` and the first-thread banner record. */
function useProjectTrust(cwd: string | undefined): [boolean | undefined, (trusted: boolean) => void] {
	const [trusted, setTrusted] = useState<boolean>();
	useEffect(() => {
		setTrusted(undefined);
		if (cwd)
			void client
				.request("project/trust/read", { cwd })
				.then((r) => setTrusted(r.trusted === true))
				.catch((e: unknown) => toast(errorText(e), "error"));
	}, [cwd]);
	const set = (value: boolean) =>
		cwd &&
		void client
			.request("project/trust/set", { cwd, trusted: value })
			.then(() => setTrusted(value))
			.catch((e: unknown) => toast(errorText(e), "error"));
	return [trusted, set];
}

/**
 * Codex's config scope, the first card of a page that edits either the user's files or a project's: the scope (the
 * sidebar's projects), and for a project, whether it is trusted, which its own files need.
 */
function ScopeCard({
	cwd,
	onCwd,
	trusted,
	onTrust,
	detail,
}: {
	cwd: string | undefined;
	onCwd: (cwd: string | undefined) => void;
	trusted: boolean | undefined;
	onTrust: (trusted: boolean) => void;
	detail: ReactNode;
}) {
	const projects = useStore(selectProjects);
	return (
		<Card>
			<Row title="Scope" detail={detail}>
				<SelectMenu
					label="Scope"
					value={cwd ?? ""}
					onChange={(v) => onCwd(v || undefined)}
					options={[
						{ value: "", label: "User config" },
						...projects.map((p) => ({ value: p.path, label: p.name ?? basename(p.path) })),
					]}
				/>
			</Row>
			{cwd ? (
				<Row
					title="Trust this project"
					detail="A trusted project's own settings, extensions, skills and MCP servers load with it"
				>
					<Switch label="Trust this project" checked={trusted === true} onChange={onTrust} />
				</Row>
			) : null}
		</Card>
	);
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const CONFIGURATION: [string, Field[]][] = [
	[
		"Model",
		[
			{
				key: "defaultThinkingLevel",
				title: "Default reasoning",
				detail: "Where new threads start, unless a model has its own level below",
				kind: "select",
				options: THINKING_LEVELS.map((level) => [level, levelName(level)]),
				fallback: "medium",
			},
		],
	],
	[
		"Context",
		[
			{
				key: "compaction.enabled",
				title: "Auto-compact",
				detail: "Summarize earlier conversation when a thread nears the model's context window",
				kind: "switch",
			},
			{
				key: "compaction.reserveTokens",
				title: "Reserved tokens",
				detail: "Room kept for the prompt and the response; compaction starts when less is left",
				kind: "number",
				min: 0,
				max: 1_000_000,
				unit: "tokens",
			},
			{
				key: "compaction.keepRecentTokens",
				title: "Recent tokens kept",
				detail: "The latest conversation kept word for word after compacting",
				kind: "number",
				min: 0,
				max: 1_000_000,
				unit: "tokens",
			},
		],
	],
	[
		"Messages",
		[
			{
				key: "steeringMode",
				title: "Steering",
				detail: "Messages steered into a running turn reach it one per response, or all at once",
				kind: "select",
				options: [
					["one-at-a-time", "One at a time"],
					["all", "All at once"],
				],
			},
			{
				key: "enableSkillCommands",
				title: "Skill commands",
				detail: "Offer each skill as /skill:name",
				kind: "switch",
			},
		],
	],
	[
		"Images",
		[
			{
				key: "images.autoResize",
				title: "Resize large images",
				detail: "Scale images to at most 2000 by 2000 pixels before sending them",
				kind: "switch",
			},
			{
				key: "images.blockImages",
				title: "Block images",
				detail: "Never send images to model providers",
				kind: "switch",
			},
		],
	],
	[
		"Network",
		[
			{
				key: "transport",
				title: "Transport",
				detail: "For providers that can stream more than one way",
				kind: "select",
				options: [
					["auto", "Auto"],
					["sse", "Server-sent events"],
					["websocket", "WebSocket"],
					["websocket-cached", "Cached WebSocket"],
				],
			},
			{
				key: "httpIdleTimeoutMs",
				title: "HTTP idle timeout",
				detail: "The longest a response may pause; turn it off for local models that think for minutes",
				kind: "select",
				options: [
					[30_000, "30 seconds"],
					[60_000, "1 minute"],
					[120_000, "2 minutes"],
					[300_000, "5 minutes"],
					[0, "Off"],
				],
				fallback: 300_000,
			},
			{
				key: "cacheWarming",
				title: "Cache warming",
				detail: "Keep the provider's prompt cache warm; each refresh costs money",
				userOnly: true,
				kind: "select",
				options: [
					["off", "Off"],
					["streaming", "While a turn runs"],
					["idle", "Also between turns"],
				],
			},
		],
	],
	[
		"Projects",
		[
			{
				key: "defaultProjectTrust",
				title: "Trust new projects",
				detail: "For a project with its own extensions, skills or settings and no saved decision",
				userOnly: true,
				kind: "select",
				options: [
					["ask", "Ask"],
					["always", "Always"],
					["never", "Never"],
				],
			},
		],
	],
	[
		"Updates and privacy",
		[
			{
				key: "autoUpdate",
				title: "Automatic updates",
				detail: "Download updates to the knightcode command line automatically",
				userOnly: true,
				kind: "switch",
				fallback: true,
			},
			{
				key: "enableInstallTelemetry",
				title: "Install telemetry",
				detail: "Send an anonymous version ping after an update",
				kind: "switch",
			},
			{
				key: "warnings.anthropicExtraUsage",
				title: "Anthropic extra usage warning",
				detail: "Warn when a Claude subscription sign-in may be billed as paid extra usage",
				kind: "switch",
			},
		],
	],
];

/** Per-model reasoning overrides (`modelThinkingLevels`, keyed provider/model), added from the model list. */
function ModelReasoning({ file }: { file: SettingsFile }) {
	const models = useStore((s) => s.models);
	const levels = (at(file.read.settings, "modelThinkingLevels") ?? {}) as Record<string, string>;
	const fallback = String(at(file.read.settings, "defaultThinkingLevel") ?? "medium");
	const write = (next: Record<string, string>) =>
		file.write("modelThinkingLevels", Object.keys(next).length ? next : null);
	return (
		<Card
			title="Reasoning per model"
			aside={
				<Popover
					side="bottom"
					align="end"
					trigger={(open) => (
						<Button variant="soft" toolbar aria-expanded={open}>
							<Plus size={16} /> Add model
						</Button>
					)}
				>
					{(close) => (
						<ModelList
							model={undefined}
							onModel={(m) => {
								close();
								const level = (m.thinkingLevels as string[]).includes(fallback)
									? fallback
									: (m.thinkingLevels[0] ?? "off");
								write({ ...levels, [`${m.provider}/${m.id}`]: level });
							}}
						/>
					)}
				</Popover>
			}
		>
			{Object.keys(levels).length === 0 ? (
				<Row title="No models of their own" detail="Every model starts at the default reasoning" />
			) : null}
			{Object.entries(levels).map(([key, level]) => {
				const model = models.find((m) => `${m.provider}/${m.id}` === key);
				return (
					<Row key={key} title={model ? `${model.providerName} · ${model.name}` : key}>
						<SelectMenu
							label={`Reasoning for ${key}`}
							value={level}
							onChange={(v) => write({ ...levels, [key]: v })}
							options={(model?.thinkingLevels ?? THINKING_LEVELS).map((l) => ({ value: l, label: levelName(l) }))}
						/>
						<IconButton
							label={`Remove ${key}`}
							toolbar
							onClick={() => write(Object.fromEntries(Object.entries(levels).filter(([k]) => k !== key)))}
						>
							<Trash2 size={16} />
						</IconButton>
					</Row>
				);
			})}
		</Card>
	);
}

/** Opens a config file in the system's editor, as Codex's "Open config.toml". */
const openFile = (path: string) =>
	void client.host("host/shell/openPath", { path }).catch((e: unknown) => toast(errorText(e), "error"));

/**
 * Configuration, as Codex's page of that name: the agent's settings from settings.json, the user's or a trusted
 * project's (which overrides the user's key by key); what has no row here is one click away in the file.
 */
function Configuration() {
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	const file = useSettingsFile(cwd, trusted);
	const scope = cwd === undefined ? "global" : "project";
	const path = file?.read.paths[scope];
	const editable = file !== undefined && file.cwd === cwd && (cwd === undefined || trusted === true);
	return (
		<>
			<ScopeCard
				cwd={cwd}
				onCwd={setCwd}
				trusted={trusted}
				onTrust={setTrusted}
				detail={
					cwd === undefined
						? "Shared with knightcode in a terminal"
						: "A project's settings override the user's, key by key"
				}
			/>
			{editable ? (
				<>
					<FieldSections sections={CONFIGURATION} file={file} />
					{cwd === undefined ? <ModelReasoning file={file} /> : null}
					<Card title="Other settings">
						<Row
							title="settings.json"
							detail={file.read.versions[scope] === "none" ? `${path} (created by the first change here)` : path}
						>
							<Button
								variant="soft"
								toolbar
								disabled={!path || file.read.versions[scope] === "none"}
								onClick={() => path && openFile(path)}
							>
								<ExternalLink size={16} /> Open
							</Button>
						</Row>
					</Card>
				</>
			) : cwd !== undefined && trusted === false ? (
				<div className="text-secondary">Trust this project to give it settings of its own.</div>
			) : null}
		</>
	);
}

/** The KnightCode tools of `/tools`, as people know them. */
const TOOL_INFO: Record<string, [title: string, detail: string]> = {
	webfetch: ["Web fetch", "Read a web page as markdown or text"],
	websearch: ["Web search", "Search the web for titles, links and snippets"],
	ask_user: ["Ask user", "Let KnightCode ask you questions with choices"],
	scratchpad: ["Scratchpad", "Notes KnightCode keeps for a thread and gets back after compaction"],
	"classifier-gate": [
		"Classifier gate",
		"A classifier model screens shell and file-editing calls; risky ones need your approval",
	],
};

const CODEMODE: [string, Field[]][] = [
	[
		"Codemode",
		[
			{
				key: "codemode.mode",
				title: "Mode",
				detail: "On: tools stay callable directly and from scripts. Only: tools are reached through scripts alone",
				kind: "select",
				options: [
					["on", "On"],
					["only", "Only"],
				],
			},
			{
				key: "codemode.inlineBudget",
				title: "Inline budget",
				detail: "Tokens codemode may spend describing script-callable tools in its own description",
				kind: "number",
				min: 0,
				max: 1_000_000,
				unit: "tokens",
			},
		],
	],
];

/**
 * Tools: the KnightCode tools `/tools` turns on and off (tools.json, with their own settings), the default tool set
 * of new threads (`defaultTools`), and codemode.
 */
function Tools() {
	const [knightcode, setKnightcode] = useState<ResultOf<"tool/settings/read">>();
	const [engine, setEngine] = useState<ResultOf<"tool/list">>();
	const file = useSettingsFile(undefined);
	const [key, setKey] = useState("");
	const load = useCallback(() => {
		const failed = (e: unknown) => toast(errorText(e), "error");
		void client.request("tool/settings/read", {}).then(setKnightcode).catch(failed);
		void client.request("tool/list", {}).then(setEngine).catch(failed);
	}, []);
	useEffect(load, [load]);
	const writeTool = (name: string, settingKey: string, value: string | boolean | null) =>
		void client
			.request("tool/settings/write", { name, key: settingKey, value })
			.then(load)
			.catch((e: unknown) => toast(errorText(e), "error"));
	const own = new Set(knightcode?.tools.map((t) => t.name));
	const defaults = new Set(engine?.defaultTools);
	const setDefaults = (value: string[] | null) => void file?.write("defaultTools", value).then(load);
	return (
		<>
			<Card title="KnightCode tools">
				{knightcode?.tools.map((tool) => {
					const [title, detail] = TOOL_INFO[tool.name] ?? [tool.name, ""];
					const setting = (name: string) => tool.settings[name];
					return (
						<Fragment key={tool.name}>
							<Row title={title} detail={detail}>
								<Switch
									label={`Enable ${title}`}
									checked={tool.enabled}
									onChange={(on) => writeTool(tool.name, "enabled", on)}
								/>
							</Row>
							{tool.name === "websearch" && tool.enabled ? (
								<>
									<Row title="Search provider" detail="DuckDuckGo needs no key but may limit you; Brave needs one">
										<SelectMenu
											label="Search provider"
											value={setting("provider") === "brave" ? "brave" : "duckduckgo"}
											onChange={(v) => writeTool(tool.name, "provider", v)}
											options={[
												{ value: "duckduckgo", label: "DuckDuckGo" },
												{ value: "brave", label: "Brave Search" },
											]}
										/>
									</Row>
									<Row
										title="Brave API key"
										detail={
											setting("braveApiKey")
												? `Saved (${setting("braveApiKey")}); BRAVE_API_KEY is also read`
												: "Free at brave.com/search/api; BRAVE_API_KEY is also read"
										}
									>
										<input
											type="password"
											aria-label="Brave API key"
											value={key}
											placeholder={setting("braveApiKey") ? "Replace key" : "Paste key"}
											onChange={(e) => setKey(e.target.value)}
											onKeyDown={(e) => {
												if (!matches(e, "desktop.item.activate") || !key.trim()) return;
												writeTool(tool.name, "braveApiKey", key.trim());
												setKey("");
											}}
											className="kc-input h-7 w-48 border-line-strong px-2"
										/>
										{setting("braveApiKey") ? (
											<IconButton
												label="Remove the key"
												toolbar
												onClick={() => writeTool(tool.name, "braveApiKey", null)}
											>
												<Trash2 size={16} />
											</IconButton>
										) : null}
									</Row>
								</>
							) : null}
							{tool.name === "classifier-gate" && tool.enabled ? (
								<Row title="Classifier model" detail="Sign in to OpenRouter for Jev">
									<SelectMenu
										label="Classifier model"
										value={typeof setting("model") === "string" ? String(setting("model")) : undefined}
										onChange={(v) => writeTool(tool.name, "model", v)}
										options={(knightcode?.classifiers ?? []).map((m) => ({
											value: `${m.provider}/${m.id}`,
											label: m.name,
											description: `${m.provider}/${m.id}`,
										}))}
									/>
								</Row>
							) : null}
						</Fragment>
					);
				})}
			</Card>
			<Card
				title="Default tools"
				aside={
					file?.read.origins.defaultTools === "global" ? (
						<Button color="secondary" toolbar onClick={() => setDefaults(null)}>
							Reset
						</Button>
					) : null
				}
			>
				<Row
					title="Tools new threads start with"
					detail="Extensions and threads can turn tools on and off as they run"
				/>
				{engine?.tools
					.filter((tool) => !own.has(tool.name))
					.map((tool) => (
						<Row
							key={tool.name}
							title={<span className="font-code">{tool.name}</span>}
							detail={<span className="line-clamp-2">{tool.description}</span>}
						>
							{tool.source === "builtin" ? null : <span className="text-xs text-tertiary">{tool.source}</span>}
							<Switch
								label={`Start threads with ${tool.name}`}
								checked={defaults.has(tool.name)}
								onChange={(on) =>
									setDefaults(on ? [...defaults, tool.name] : [...defaults].filter((n) => n !== tool.name))
								}
							/>
						</Row>
					))}
			</Card>
			{file ? <FieldSections sections={CODEMODE} file={file} /> : null}
		</>
	);
}

const EXPOSURES: { value: McpExposure; label: string; description: string }[] = [
	{ value: "codemode", label: "Codemode", description: "Called from codemode scripts" },
	{ value: "deferred", label: "On demand", description: "Declared once tool search loads them" },
	{ value: "direct", label: "Direct", description: "Declared to the model like any tool" },
	{ value: "hidden", label: "Hidden", description: "Registered but never reachable" },
];

/** Adds a server to the user's or the project's mcp.json, as `knightcode mcp add` does. */
function AddMcpServerDialog({
	cwd,
	onAdded,
	onClose,
}: {
	cwd: string | undefined;
	onAdded: () => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [kind, setKind] = useState<"stdio" | "http">("stdio");
	const [target, setTarget] = useState("");
	const [scope, setScope] = useState<"global" | "project">("global");
	const valid = /^[A-Za-z0-9_-]+$/.test(name) && target.trim() !== "";
	const add = () => {
		// ponytail: the command splits on spaces; arguments with spaces, env and headers are set in mcp.json.
		const [command, ...args] = target.trim().split(/\s+/);
		const config = kind === "http" ? { url: target.trim() } : { command, ...(args.length ? { args } : {}) };
		void client
			.request("mcp/add", { scope, ...(scope === "project" ? { cwd } : {}), name, config })
			.then(() => {
				onAdded();
				onClose();
			})
			.catch((e: unknown) => toast(errorText(e), "error"));
	};
	return (
		<Dialog title="Add MCP server" onClose={onClose}>
			<div className="flex flex-col items-start gap-3 pt-3">
				<input
					autoFocus
					aria-label="Server name"
					value={name}
					placeholder="Name (letters, digits, - and _)"
					onChange={(e) => setName(e.target.value)}
					className="kc-input"
				/>
				<Segmented
					label="Server type"
					value={kind}
					onChange={setKind}
					options={[
						{ value: "stdio", label: "Command" },
						{ value: "http", label: "URL" },
					]}
				/>
				<input
					aria-label={kind === "http" ? "Server URL" : "Server command"}
					value={target}
					spellCheck={false}
					placeholder={kind === "http" ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-everything"}
					onChange={(e) => setTarget(e.target.value)}
					onKeyDown={(e) => valid && matches(e, "desktop.item.activate") && add()}
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
					Add server
				</Button>
			</DialogActions>
		</Dialog>
	);
}

/**
 * MCP servers, as Codex's page: the servers of the user's mcp.json and, for a trusted project, its own, each turned on
 * or off and given an exposure where `/mcp` would save it. Sign-in and live status stay with `/mcp` in a thread.
 */
function McpServers() {
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	// Tagged with its scope, newest request only: another project's list never shows (or gets acted on) under this one.
	const [loaded, setLoaded] = useState<{ cwd: string | undefined; list: ResultOf<"mcp/list"> }>();
	const latest = useRef(0);
	const list = loaded && loaded.cwd === cwd ? loaded.list : undefined;
	const [adding, setAdding] = useState(false);
	const [removing, setRemoving] = useState<ResultOf<"mcp/list">["servers"][number]>();
	const load = useCallback(() => {
		const request = ++latest.current;
		client
			.request("mcp/list", cwd === undefined ? {} : { cwd })
			.then((result) => {
				if (request === latest.current) setLoaded({ cwd, list: result });
			})
			.catch((e: unknown) => toast(errorText(e), "error"));
	}, [cwd, trusted]);
	useEffect(load, [load]);
	const run = (request: Promise<unknown>) =>
		void request.then(load).catch((e: unknown) => toast(errorText(e), "error"));
	const where = cwd === undefined ? {} : { cwd };
	return (
		<>
			<ScopeCard
				cwd={cwd}
				onCwd={setCwd}
				trusted={trusted}
				onTrust={setTrusted}
				detail="A trusted project adds the servers of its .knightcode/mcp.json"
			/>
			<Card
				title="Servers"
				aside={
					<Button variant="soft" toolbar onClick={() => setAdding(true)}>
						<Plus size={16} /> Add server
					</Button>
				}
			>
				{list?.servers.length === 0 ? (
					<Row title="No MCP servers" detail="Add one here, or with knightcode mcp add" />
				) : null}
				{list?.servers.map((server) => (
					<Row
						key={server.name}
						title={
							<span className="flex items-center gap-2">
								{server.name}
								<span className="text-xs font-normal text-tertiary">
									{server.scope === "project" ? "Project" : server.override ? "User, changed by the project" : "User"}
								</span>
							</span>
						}
						detail={
							<>
								<span className="font-code">{server.target}</span>
								{server.description ? <span className="block">{server.description}</span> : null}
							</>
						}
					>
						<SelectMenu
							label={`Exposure of ${server.name}`}
							value={server.exposure}
							onChange={(exposure) => run(client.request("mcp/update", { ...where, name: server.name, exposure }))}
							options={EXPOSURES}
						/>
						<Switch
							label={`Enable ${server.name}`}
							checked={server.enabled}
							onChange={(enabled) => run(client.request("mcp/update", { ...where, name: server.name, enabled }))}
						/>
						<IconButton label={`Remove ${server.name}`} toolbar onClick={() => setRemoving(server)}>
							<Trash2 size={16} />
						</IconButton>
					</Row>
				))}
			</Card>
			{list?.errors.length ? (
				<Card title="Problems">
					{list.errors.map((error) => (
						<Row key={error} title={<span className="font-normal text-danger-text">{error}</span>} />
					))}
				</Card>
			) : null}
			<Card>
				<Row
					title="Sign-in and status"
					detail="Sign in to a server, reconnect it or see its tools with /mcp in a thread"
				/>
				<Row title="mcp.json" detail="Environment variables, headers and OAuth settings are set in the file">
					{list ? (
						<Button variant="soft" toolbar onClick={() => openFile(list.paths.global)}>
							<ExternalLink size={16} /> User file
						</Button>
					) : null}
					{list?.paths.project ? (
						<Button variant="soft" toolbar onClick={() => openFile(list.paths.project!)}>
							<ExternalLink size={16} /> Project file
						</Button>
					) : null}
				</Row>
			</Card>
			{adding ? (
				<AddMcpServerDialog cwd={trusted ? cwd : undefined} onAdded={load} onClose={() => setAdding(false)} />
			) : null}
			{removing ? (
				<ConfirmDialog
					title={`Remove ${removing.name}?`}
					description={`This deletes its entry from ${removing.source}.`}
					confirm="Remove"
					onConfirm={() => run(client.request("mcp/remove", { ...where, scope: removing.scope, name: removing.name }))}
					onClose={() => setRemoving(undefined)}
				/>
			) : null}
		</>
	);
}

const RESOURCE_GROUPS: [ResourceType, string][] = [
	["extensions", "Extensions"],
	["skills", "Skills"],
	["prompts", "Prompt templates"],
	["themes", "Themes"],
];

/** Where a resource comes from, as `knightcode config` groups them. */
function resourceOrigin(resource: Resource): string {
	const where = resource.origin === "package" ? resource.source : resource.path;
	return `${{ user: "User", project: "Project", temporary: "This session" }[resource.scope]} · ${where}`;
}

/**
 * Extensions and skills, as `knightcode config`: every extension, skill, prompt template and theme a thread in the
 * scope would find, each loaded or skipped by a pattern in the settings.json that names it.
 */
function Extensions() {
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	// Tagged with its scope, newest request only: another project's list never shows (or gets acted on) under this one.
	const [loaded, setLoaded] = useState<{ cwd: string | undefined; list: ResultOf<"resource/list"> }>();
	const latest = useRef(0);
	const list = loaded && loaded.cwd === cwd ? loaded.list : undefined;
	const load = useCallback(() => {
		const request = ++latest.current;
		client
			.request("resource/list", cwd === undefined ? {} : { cwd })
			.then((result) => {
				if (request === latest.current) setLoaded({ cwd, list: result });
			})
			.catch((e: unknown) => toast(errorText(e), "error"));
	}, [cwd, trusted]);
	useEffect(load, [load]);
	const toggle = (resource: Resource, enabled: boolean) =>
		void client
			.request("resource/set", {
				...(cwd === undefined ? {} : { cwd }),
				type: resource.type,
				path: resource.path,
				enabled,
			})
			.then(load)
			.catch((e: unknown) => toast(errorText(e), "error"));
	return (
		<>
			<ScopeCard
				cwd={cwd}
				onCwd={setCwd}
				trusted={trusted}
				onTrust={setTrusted}
				detail="Threads load these when they start or resume. A trusted project adds its own"
			/>
			{RESOURCE_GROUPS.map(([type, title]) => {
				const rows = list?.resources.filter((r) => r.type === type) ?? [];
				return rows.length ? (
					<Card key={type} title={title}>
						{rows.map((resource) => (
							<Row key={resource.path} title={resource.name} detail={resourceOrigin(resource)}>
								{/* Resources from command-line flags last one session; there is nothing to save. */}
								{resource.scope === "temporary" ? null : (
									<Switch
										label={`Load ${resource.name}`}
										checked={resource.enabled}
										onChange={(on) => toggle(resource, on)}
									/>
								)}
							</Row>
						))}
					</Card>
				) : null;
			})}
		</>
	);
}

type PluginRow = ResultOf<"plugin/list">["plugins"][number];
type MarketplaceRow = ResultOf<"plugin/marketplace/list">["marketplaces"][number];
type CatalogEntry = MarketplaceRow["plugins"][number];

/** Catalogs older than this are fetched again when the page opens, as `/plugins` does. */
const CATALOG_TTL_MS = 5 * 60 * 1000;
/** How many of a marketplace's plugins show until "Show all". */
const CATALOG_PREVIEW = 20;

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
			.catch((e: unknown) => toast(errorText(e), "error"))
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
					onKeyDown={(e) => valid && matches(e, "desktop.item.activate") && add()}
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

/** What a plugin offers and runs: its commands, skills, MCP servers and the environment they read. */
function pluginInventory(plugin: PluginRow): string[] {
	return [
		...(plugin.commands.length ? [`Commands: ${plugin.commands.map((c) => `/${c}`).join(", ")}`] : []),
		...(plugin.skills.length ? [`Skills: ${plugin.skills.join(", ")}`] : []),
		...plugin.mcpServers.map((server) => `MCP server ${server.name}: ${server.target}`),
		...(plugin.environment.length ? [`Reads environment variables: ${plugin.environment.join(", ")}`] : []),
	];
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

/** Everything a plugin holds, under its row once opened. Its own skills drop the `<plugin>:` they all carry. */
function PluginDetails({ plugin }: { plugin: PluginRow }) {
	const prefix = `${plugin.namespace}:`;
	const own = (name: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
	const facts: [string, ReactNode][] = [
		["Source", <span className="font-code">{plugin.ref ? `${plugin.source}#${plugin.ref}` : plugin.source}</span>],
		...(plugin.skills.length ? [["Skills", plugin.skills.map(own).join(", ")] as [string, ReactNode]] : []),
		...(plugin.commands.length
			? [["Commands", plugin.commands.map((command) => `/${command}`).join(", ")] as [string, ReactNode]]
			: []),
		...plugin.mcpServers.map((server): [string, ReactNode] => [
			"MCP server",
			<>
				<span className="text-ink">{server.name}</span> <span className="font-code">{server.target}</span>
			</>,
		]),
		...(plugin.environment.length
			? [["Reads", <span className="font-code">{plugin.environment.join(", ")}</span>] as [string, ReactNode]]
			: []),
		...(plugin.unsupported.length ? [["Never runs", plugin.unsupported.join(", ")] as [string, ReactNode]] : []),
	];
	return (
		<div className="flex flex-col gap-2 px-4 pb-3">
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

/** Asked before a plugin is trusted: it lists what the plugin will run, and what KnightCode will not run. */
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
		<Dialog title={`Trust ${plugin.name}?`} onClose={onClose}>
			<div className="flex flex-col gap-2 pt-3 text-sm">
				<p className="text-secondary">
					Trusting it lets new threads run its MCP servers and offer its skills and commands:
				</p>
				<ul className="flex flex-col gap-1 font-code text-xs">
					{pluginInventory(plugin).map((line) => (
						<li key={line}>{line}</li>
					))}
				</ul>
				{plugin.unsupported.length ? (
					<p className="text-xs text-secondary">Not supported, never run: {plugin.unsupported.join(", ")}</p>
				) : null}
				{plugin.warnings.map((warning) => (
					<p key={warning} className="text-xs text-secondary">
						{warning}
					</p>
				))}
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
function Plugins() {
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	const [tab, setTab] = useState<"installed" | "marketplace">("installed");
	const [query, setQuery] = useState("");
	// Tagged with its scope, newest request only: another project's list never shows (or gets acted on) under this one.
	const [loaded, setLoaded] = useState<{
		cwd: string | undefined;
		plugins: ResultOf<"plugin/list">;
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
	const load = useCallback(() => {
		const request = ++latest.current;
		const params = cwd === undefined ? {} : { cwd };
		Promise.all([client.request("plugin/list", params), client.request("plugin/marketplace/list", params)])
			.then(([plugins, markets]) => {
				if (request === latest.current) setLoaded({ cwd, plugins, marketplaces: markets.marketplaces });
			})
			.catch((e: unknown) => toast(errorText(e), "error"));
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
			.catch((e: unknown) => toast(errorText(e), "error"))
			.finally(() => {
				setBusy(false);
				setWorking(undefined);
			});
	};
	const install = (params: { source: string; ref?: string; scope: "global" | "project" }) =>
		client.request("plugin/install", { ...where, ...params }).then(({ plugin }) => setTrusting(plugin));
	const update = (plugin: PluginRow, key: string) =>
		run(
			key,
			() => client.request("plugin/update", { ...where, scope: plugin.scope, name: plugin.identity }),
			(result) => toast(result.changed ? `Updated ${plugin.name}` : `${plugin.name} is up to date`, "info"),
		);
	/** Fetches a catalog again; its card shows the fetch and what went wrong. */
	const fetchCatalog = (name: string) => {
		setFetching((names) => new Set(names).add(name));
		void client
			.request("plugin/marketplace/update", { ...where, name })
			.then(
				() => undefined,
				(e: unknown) => errorText(e),
			)
			.then((failure) => {
				setFailed((failures) => {
					const next = new Map(failures);
					if (failure === undefined) next.delete(name);
					else next.set(name, failure);
					return next;
				});
				setFetching((names) => {
					const next = new Set(names);
					next.delete(name);
					return next;
				});
				load();
			});
	};
	// As `/plugins`: catalogs never fetched, or fetched a few minutes ago, are fetched in the background once.
	useEffect(() => {
		for (const market of list?.marketplaces ?? []) {
			const key = `${cwd ?? ""}\n${market.name}`;
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
									client.request("plugin/set", {
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
		const failure = failed.get(market.name);
		const busyFetching = fetching.has(market.name);
		const detail = failure ? (
			<span className="text-danger-text">Couldn't fetch the catalog: {failure}</span>
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
				{market.diagnostics.length ? (
					<span className="block text-danger-text">{market.diagnostics.join("; ")}</span>
				) : null}
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
							: client.request("plugin/marketplace/add", { ...where, ...params }).then(load)
					}
					onClose={() => setAdding(undefined)}
				/>
			) : null}
			{trusting ? (
				<TrustPluginDialog
					plugin={trusting}
					onTrust={() =>
						run(`${trusting.scope}:${trusting.identity}`, () =>
							client.request("plugin/set", {
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
							client.request("plugin/uninstall", { ...where, scope: removing.scope, name: removing.identity }),
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
							client.request("plugin/marketplace/remove", {
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

function About() {
	const [info, setInfo] = useState<{ appVersion: string; serverVersion: string; platform: string; logsDir: string }>();
	useEffect(() => void client.host("host/app/info", {}).then(setInfo), []);
	return (
		<Card>
			<Row title="KnightCode desktop">
				<span className="text-sm text-secondary">{info?.appVersion}</span>
			</Row>
			<Row title="App server">
				<span className="text-sm text-secondary">{info?.serverVersion}</span>
			</Row>
			<Updates />
			<Row title="Logs" detail={info?.logsDir}>
				<Button
					variant="soft"
					toolbar
					onClick={() =>
						info && void client.host("host/shell/showInFolder", { path: `${info.logsDir}/app-server.log` })
					}
				>
					Show logs
				</Button>
			</Row>
		</Card>
	);
}

/** Settings › About's updates row: where updating stands, and the one thing to do about it. */
function Updates() {
	const update = useStore((s) => s.update);
	const detail =
		update.state === "unavailable"
			? window.knightcode.platform === "linux"
				? "Update KnightCode with the package manager you installed it with."
				: "Updates come with an installed build."
			: update.state === "checking"
				? "Checking for updates…"
				: update.state === "downloading"
					? "Downloading an update…"
					: update.state === "ready"
						? `KnightCode ${update.version ? `${update.version} ` : ""}is ready. It installs when KnightCode restarts.`
						: update.state === "available"
							? `KnightCode ${update.version} is available.`
							: update.error
								? `The last check failed: ${update.error}`
								: update.checkedAt
									? `Up to date. Checked ${new Date(update.checkedAt).toLocaleString()}.`
									: undefined;
	return (
		<Row title="Updates" detail={detail}>
			{update.state === "ready" ? (
				<Button variant="soft" toolbar onClick={installUpdate}>
					Restart to update
				</Button>
			) : update.state === "available" ? (
				<Button variant="soft" toolbar onClick={() => openUpdatePage(update.url)}>
					Download
				</Button>
			) : update.state === "unavailable" ? null : (
				<Button
					variant="soft"
					toolbar
					disabled={update.state === "checking" || update.state === "downloading"}
					onClick={checkForUpdates}
				>
					Check for updates
				</Button>
			)}
		</Row>
	);
}

/** Codex's page title: a 46px band and 16px over it, 28px medium in the 768px column, any actions at its end. */
function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
	return (
		<div className="mx-auto flex w-full max-w-[768px] items-center justify-between gap-4 px-5 pt-[62px]">
			<h1 className="flex min-h-15 items-center text-[28px] leading-[33.6px] font-medium">{title}</h1>
			{actions}
		</div>
	);
}

/** The page's sections, 40px apart in the 768px column. */
const PageBody = ({ children }: { children: ReactNode }) => (
	<div className="mx-auto flex w-full max-w-[768px] flex-col gap-10 p-5">{children}</div>
);

export function Settings({ page }: { page: SettingsPage }) {
	const title = SETTINGS_PAGES.find((p) => p.page === page)?.label ?? "";
	const body = {
		general: <General />,
		appearance: <Appearance />,
		models: <Models />,
		shortcuts: <Shortcuts />,
		archived: null,
		configuration: <Configuration />,
		tools: <Tools />,
		mcp: <McpServers />,
		extensions: <Extensions />,
		plugins: <Plugins />,
		worktrees: <Worktrees />,
		about: <About />,
	}[page];
	return (
		<div className="min-w-0 flex-1 overflow-y-auto">
			{/* Archived threads puts Delete all beside its title, so it draws its own header. */}
			{page === "archived" ? (
				<Archived title={title} />
			) : (
				<>
					<PageHeader title={title} />
					<PageBody>{body}</PageBody>
				</>
			)}
		</div>
	);
}
