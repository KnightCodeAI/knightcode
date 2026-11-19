/** Public settings, appearance and feedback bindings over the existing store, appearance derivation and app server. */
import type {
	experimental_Appearance,
	experimental_AppearanceState,
	experimental_CommandContext,
	experimental_ConfigFile,
	experimental_SettingsControls,
	experimental_SettingsField,
	experimental_SettingsPage,
	experimental_SettingsRequests,
	experimental_SettingsServices,
	experimental_ThemeCustomization,
	experimental_ThemeName,
	experimental_ThemePresetEntry,
	experimental_Zoom,
} from "@knightcodeai/cli/desktop";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Value } from "typebox/value";
import { Preferences } from "../../shared/host-protocol.ts";
import { comboFromEvent, DESKTOP_KEYBINDINGS, type KeybindingId } from "../../shared/keybindings.ts";
import { ACCENTS, BASE, customTokens, DEFAULT_CONTRAST, isHex, parseThemeString, themeString } from "../appearance.ts";
import { filterArchived, NO_PROJECT } from "../archive-filter.ts";
import { client } from "../client.ts";
import { IconButton, Segmented } from "../components/button.tsx";
import { ModelList } from "../components/composer-pickers.tsx";
import { DialogActions } from "../components/dialog.tsx";
import { Search, Undo } from "../components/icons.tsx";
import { SelectMenu } from "../components/menu.tsx";
import { SidebarFrame } from "../components/sidebar.tsx";
import { Switch } from "../components/switch.tsx";
import { basename, samePath } from "../format.ts";
import { isMac, keyLabel, matches } from "../keys.ts";
import {
	answerLogin,
	cancelLogin,
	customize,
	deleteThread,
	errorText,
	getState,
	listArchived,
	logout,
	refreshAccounts,
	selectPreferences,
	setDefaultModel,
	setKeybinding,
	setPreference,
	startLogin,
	toast,
	unarchive,
	useStore,
} from "../store.ts";
import { useCommandContext } from "./command-context.ts";
import { desktopExtensions } from "./runtime.ts";
import { NativeExtensionsSettings } from "./settings.tsx";
import { ContributionRoot, ThemeProvider } from "./surface.tsx";
import type { SettingsSectionRegistration } from "./registry.ts";

declare global {
	interface Window {
		/** Chromium's Local Font Access, which lists the installed fonts (not in TypeScript's DOM types yet). */
		queryLocalFonts(): Promise<{ family: string; style: string; postscriptName: string }[]>;
	}
}

type Gate = () => boolean;
const always: Gate = () => true;

/** App-server methods settings may call; the wire boundary refuses every other method. */
export const SETTINGS_METHODS: ReadonlySet<string> = new Set<keyof experimental_SettingsRequests>([
	"account/list",
	"config/read",
	"config/write",
	"environment/list",
	"environment/save",
	"mcp/add",
	"mcp/list",
	"mcp/remove",
	"mcp/update",
	"plugin/install",
	"plugin/list",
	"plugin/marketplace/add",
	"plugin/marketplace/list",
	"plugin/marketplace/remove",
	"plugin/marketplace/update",
	"plugin/set",
	"plugin/uninstall",
	"plugin/update",
	"project/trust/read",
	"project/trust/set",
	"resource/list",
	"resource/set",
	"thread/list",
	"tool/list",
	"tool/settings/read",
	"tool/settings/write",
	"worktree/delete",
	"worktree/list",
]);

const refused = () => Promise.reject(new Error("This extension is no longer active."));

/** Settings services; `admitted` gates every intent so a retired revision's handles go inert. */
export function settingsServices(admitted: Gate = always): experimental_SettingsServices {
	const host = <T,>(work: () => Promise<unknown>, value: T) =>
		admitted()
			? work().then(
					() => value,
					(error: unknown) => {
						toast(errorText(error), "error");
						return false as T;
					},
				)
			: Promise.resolve(false as T);
	return {
		experimental_request: (method, params) => {
			// Wire boundary: the generic type is not a runtime guarantee for external callers.
			if (!SETTINGS_METHODS.has(method)) return Promise.reject(new Error(`Unsupported settings method: ${method}`));
			if (!admitted()) return refused();
			return client.request(method, params as never) as never;
		},
		experimental_usePreferences: () => useStore(selectPreferences),
		experimental_setPreference: (key, value) => {
			// Wire boundary: extension values are not type-checked at runtime; main would refuse the whole state write.
			const next = { ...selectPreferences(getState()), [key]: value };
			if (!admitted() || !Value.Check(Preferences, next)) return false;
			setPreference(key, value as never);
			return true;
		},
		experimental_keybindings: () =>
			(Object.keys(DESKTOP_KEYBINDINGS) as KeybindingId[]).map((id) => ({
				id,
				description: DESKTOP_KEYBINDINGS[id].description,
				defaultKeys: DESKTOP_KEYBINDINGS[id].defaultKeys,
			})),
		experimental_setKeybinding: (id, keys) => {
			// Declaration boundary: ids come from extension code as plain strings.
			if (
				!admitted() ||
				!Object.hasOwn(DESKTOP_KEYBINDINGS, id) ||
				(keys !== undefined && !(Array.isArray(keys) && keys.every((k) => typeof k === "string")))
			)
				return false;
			setKeybinding(id as KeybindingId, keys);
			return true;
		},
		experimental_comboFromEvent: (event) => comboFromEvent(event, isMac()),
		experimental_keyLabel: keyLabel,
		experimental_useAccounts: () => useStore((s) => s.accounts),
		experimental_refreshAccounts: async () => {
			if (admitted()) await refreshAccounts();
		},
		experimental_useLogin: (id) => useStore((s) => s.logins[id]) as never,
		experimental_startLogin: async (provider, type) => (admitted() ? startLogin(provider, type) : undefined),
		experimental_answerLogin: async (id, value) => {
			if (admitted()) await answerLogin(id, value);
		},
		experimental_cancelLogin: async (id) => {
			if (admitted()) await cancelLogin(id);
		},
		experimental_logout: async (provider) => {
			if (admitted()) await logout(provider);
		},
		experimental_useDefaultModel: () => useStore((s) => s.defaultModel),
		experimental_setDefaultModel: async (model) => {
			if (admitted()) await setDefaultModel(model);
		},
		experimental_listArchived: () => (admitted() ? listArchived() : refused()),
		experimental_unarchive: async (id) => {
			if (admitted()) await unarchive(id);
		},
		experimental_deleteThread: async (id) => {
			if (admitted()) await deleteThread(id);
		},
		// Ids only: a status or name change must not reread the whole archive.
		experimental_useLiveThreadIds: () => useStore((s) => s.threads.map((t) => t.id).join("\n")),
		experimental_appInfo: () => client.host("host/app/info", {}),
		experimental_openExternal: (url) => host(() => client.host("host/shell/openExternal", { url }), true),
		experimental_openPath: (path) => host(() => client.host("host/shell/openPath", { path }), true),
		experimental_copyText: (text) => host(() => client.host("host/clipboard/writeText", { text }), true),
		experimental_errorText: errorText,
		experimental_filterArchived: (threads, filter, projects) =>
			filterArchived(threads, filter, projects, samePath, basename),
		experimental_noProject: NO_PROJECT,
		experimental_NativeExtensions: NativeExtensionsSettings,
	};
}

/** Appearance API; theme changes and presets go through the existing preference store only. */
export function appearance(admitted: Gate = always): experimental_Appearance {
	const gate =
		<A extends unknown[]>(run: (...args: A) => void) =>
		(...args: A) => {
			if (!admitted()) return false;
			run(...args);
			return true;
		};
	return {
		experimental_useState: useAppearanceState,
		experimental_usePresets: useThemePresets,
		experimental_base: (theme) => BASE[theme],
		experimental_accents: ACCENTS,
		experimental_defaultContrast: DEFAULT_CONTRAST,
		experimental_setMode: gate((mode) => setPreference("theme", mode)),
		experimental_customize: gate((theme, patch, replace) => customize(theme, validCustomization(patch), replace)),
		experimental_applyPreset: (id) => {
			const preset = desktopExtensions.themePresets().find((entry) => entry.id === id);
			if (!preset || !admitted()) return false;
			customize(preset.contribution.theme, validCustomization(preset.contribution.customization), true);
			return true;
		},
		experimental_setSize: gate((key, px) => setPreference(key, px)),
		experimental_setDiffMarkers: gate((markers) =>
			setPreference("diffMarkers", markers === "color" ? undefined : markers),
		),
		experimental_setPointerCursors: gate((on) => setPreference("pointerCursors", on || undefined)),
		experimental_themeString: themeString,
		experimental_parseThemeString: parseThemeString,
		experimental_localFonts: () =>
			window.queryLocalFonts().then(
				(fonts) => fonts,
				() => undefined,
			),
	};
}

/** Declaration boundary: extension patches are plain data; keep only well-formed fields, like an imported string. */
function validCustomization(
	patch: experimental_ThemeCustomization | undefined,
): experimental_ThemeCustomization | undefined {
	if (!patch) return undefined;
	const custom: experimental_ThemeCustomization = {};
	for (const key of ["accent", "background", "foreground"] as const) {
		const value = patch[key];
		if (value === undefined || (typeof value === "string" && isHex(value))) custom[key] = value?.toLowerCase();
	}
	for (const key of ["font", "fontStyle", "contentFont", "contentFontStyle", "codeFont", "codeFontStyle"] as const)
		if (key in patch) custom[key] = typeof patch[key] === "string" ? patch[key] : undefined;
	if ("contrast" in patch)
		custom.contrast =
			typeof patch.contrast === "number" && patch.contrast >= 0 && patch.contrast <= 100 ? patch.contrast : undefined;
	if ("translucentSidebar" in patch) custom.translucentSidebar = patch.translucentSidebar === true || undefined;
	return custom;
}

function useAppearanceState(): experimental_AppearanceState {
	const prefs = useStore(selectPreferences);
	const theme = useStore((s) => s.resolvedTheme);
	return useMemo(
		() => ({
			mode: prefs.theme,
			theme,
			customization: prefs.appearance ?? {},
			uiFontSize: prefs.uiFontSize,
			codeFontSize: prefs.codeFontSize,
			diffMarkers: prefs.diffMarkers,
			pointerCursors: prefs.pointerCursors,
		}),
		[prefs, theme],
	);
}

function useThemePresets(): readonly experimental_ThemePresetEntry[] {
	const entries = useSyncExternalStore(
		desktopExtensions.subscribe,
		desktopExtensions.getSnapshot,
		desktopExtensions.getSnapshot,
	);
	return useMemo(
		() =>
			desktopExtensions.themePresets().map((entry) => ({ ...entry.contribution, id: entry.id, owner: entry.owner })),
		[entries],
	);
}

/** A theme preview: tokens on the subtree, and the same theme carried into owned portals and overlay roots. */
export function ThemeScope({
	theme,
	customization,
	className,
	children,
}: {
	theme: experimental_ThemeName;
	customization?: experimental_ThemeCustomization;
	className?: string;
	children: ReactNode;
}) {
	const value = useMemo(() => ({ theme, tokens: customTokens(theme, customization) }), [theme, customization]);
	return (
		<ThemeProvider value={value}>
			<span data-theme={theme} className={className} style={value.tokens}>
				{children}
			</span>
		</ThemeProvider>
	);
}

let zoom: experimental_Zoom = { factor: 1, changes: 0 };
const readZoom = () => zoom;
const zoomListeners = new Set<() => void>();
const subscribeZoom = (listener: () => void) => {
	zoomListeners.add(listener);
	return () => void zoomListeners.delete(listener);
};

/** Follow window zoom for the host lifetime, so a presenter mounted or replaced later reads the current level. */
export function startZoomFeedback(signal: AbortSignal): void {
	const off = client.onHostEvent((event) => {
		if (event.event !== "zoom") return;
		zoom = { factor: event.factor, changes: zoom.changes + 1 };
		for (const notify of zoomListeners) notify();
	});
	signal.addEventListener("abort", off, { once: true });
}

/** The window zoom level as host feedback state; a remounted presenter keeps the current level. */
export const useZoom = (): experimental_Zoom => useSyncExternalStore(subscribeZoom, readZoom, readZoom);

/** A page's admitted sections in order, each mounted at its own owner root. */
export function SettingsSections({ page }: { page: experimental_SettingsPage }) {
	const context = useCommandContext();
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot, desktopExtensions.getSnapshot);
	// The recovery route stays usable with every extension wedged: only built-in sections mount there.
	const sections = desktopExtensions.settingsSections(page, context, page === "extensions");
	return (
		<>
			{sections.map((entry) => (
				<SettingsSectionRoot key={entry.sequence} entry={entry} context={context} />
			))}
		</>
	);
}

function SettingsSectionRoot({
	entry,
	context,
}: {
	entry: SettingsSectionRegistration;
	context: experimental_CommandContext;
}) {
	const section = entry.contribution;
	return (
		<ContributionRoot entry={entry}>
			{"fields" in section ? (
				<BackendSettingsSection entry={entry} title={section.title} fields={section.fields} />
			) : (
				<section.experimental_render context={context} signal={entry.signal} />
			)}
		</ContributionRoot>
	);
}

/** A schema section over the owner's S6 backend app settings; the frontend never sees secret values. */
function BackendSettingsSection({
	entry,
	title,
	fields,
}: {
	entry: SettingsSectionRegistration;
	title: string;
	fields: readonly experimental_SettingsField[];
}) {
	const backendOf = () => (entry.activation?.admitted() ? entry.activation.backend : undefined);
	const backend = useSyncExternalStore(
		(listener) => entry.activation?.subscribe(listener) ?? (() => {}),
		backendOf,
		backendOf,
	);
	const [values, setValues] = useState<Record<string, unknown>>();
	const [problem, setProblem] = useState<string>();
	useEffect(() => {
		if (!backend) return;
		const lifetime = new AbortController();
		void backend.experimental_settings(undefined, AbortSignal.any([lifetime.signal, entry.signal])).then((result) => {
			if (lifetime.signal.aborted) return;
			if (result.status === "ok") setValues(result.value);
			else setProblem(result.status === "error" ? result.message : result.status);
		});
		return () => lifetime.abort();
	}, [backend, entry.signal]);
	const write = async (key: string, value: unknown) => {
		if (!backend) return;
		const result = await backend.experimental_setSetting(key, value, undefined, entry.signal);
		if (entry.signal.aborted) return;
		if (result.status === "ok") setValues(result.value);
		else toast(result.status === "error" ? result.message : `Setting not saved: ${result.status}`, "error");
	};
	return (
		<Card title={title}>
			{!entry.activation ? (
				<Row title="This section needs a desktop backend." />
			) : problem ? (
				<Row title={<span className="font-normal text-danger-text">{problem}</span>} />
			) : values === undefined ? (
				<Row title={<span className="kc-pulse font-normal text-tertiary">Loading…</span>} />
			) : (
				fields.map((field) => (
					<FieldControl
						key={field.key}
						field={field}
						value={values[field.key] ?? field.fallback}
						write={(value) => void write(field.key, value)}
					/>
				))
			)}
		</Card>
	);
}

/** A field's control over its current value, the same for built-in config and extension backend fields. */
function FieldControl({
	field,
	value,
	write,
	reset,
}: {
	field: experimental_SettingsField;
	value: unknown;
	write(value: unknown): void;
	reset?: ReactNode;
}) {
	let control: ReactNode;
	if (field.kind === "switch") control = <Switch label={field.title} checked={value === true} onChange={write} />;
	else if (field.kind === "number")
		control = (
			<SizeField
				label={field.title}
				value={Number(value ?? 0)}
				min={field.min}
				max={field.max}
				unit={field.unit}
				onChange={write}
			/>
		);
	else {
		// A value the choices lack (a hand-edited one) still shows as itself.
		const known = field.options.some(([option]) => JSON.stringify(option) === JSON.stringify(value));
		const options = known || value === undefined ? field.options : [...field.options, [value, String(value)] as const];
		control = (
			<SelectMenu
				label={field.title}
				value={JSON.stringify(value)}
				onChange={(v) => write(JSON.parse(v))}
				options={options.map(([option, label]) => ({ value: JSON.stringify(option), label }))}
			/>
		);
	}
	return (
		<Row title={field.title} detail={field.detail}>
			{reset}
			{control}
		</Row>
	);
}

/** The value at a dotted key. */
const at = (value: unknown, key: string): unknown =>
	key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], value);

/** One scope's settings.json, shared with the terminal: each write rereads, so rows show what landed. */
function useConfigFile(cwd: string | undefined, trusted?: boolean): experimental_ConfigFile | undefined {
	// Each result keeps the scope it was read for, and only the newest request lands: after a scope switch, the old
	// scope's values never show (or get written) under the new one.
	const [loaded, setLoaded] = useState<{ cwd: string | undefined; read: experimental_ConfigFile["read"] }>();
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

/** Sections of settings.json fields as cards; a project's page leaves out what only the user's file sets. */
function ConfigFields({
	sections,
	file,
}: {
	sections: readonly (readonly [title: string, fields: readonly experimental_SettingsField[]])[];
	file: experimental_ConfigFile;
}) {
	const { read, cwd, write } = file;
	return (
		<>
			{sections.map(([title, fields]) => {
				const shown = fields.filter((f) => cwd === undefined || !f.userOnly);
				return shown.length ? (
					<Card key={title} title={title}>
						{shown.map((field) => (
							<FieldControl
								key={field.key}
								field={field}
								value={at(read.settings, field.key) ?? at(read.defaults, field.key) ?? field.fallback}
								write={(value) => void write(field.key, value)}
								reset={
									read.origins[field.key] === (cwd === undefined ? "global" : "project") ? (
										<IconButton
											label={cwd === undefined ? "Reset to default" : "Use the user setting"}
											toolbar
											onClick={() => void write(field.key, null)}
										>
											<Undo size={16} />
										</IconButton>
									) : null
								}
							/>
						))}
					</Card>
				) : null;
			})}
		</>
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

export const settingsControls: experimental_SettingsControls = {
	experimental_Row: Row,
	experimental_Section: Section,
	experimental_Box: Box,
	experimental_Card: Card,
	experimental_PageHeader: PageHeader,
	experimental_PageBody: PageBody,
	experimental_PageBar: PageBar,
	experimental_SearchField: SearchField,
	experimental_SizeField: SizeField,
	experimental_SelectMenu: SelectMenu,
	experimental_Segmented: Segmented,
	experimental_DialogActions: DialogActions,
	experimental_SidebarFrame: SidebarFrame,
	experimental_ModelList: ModelList,
	experimental_ConfigFields: ConfigFields,
	experimental_useConfigFile: useConfigFile,
};
