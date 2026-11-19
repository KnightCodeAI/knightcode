/** Settings › Appearance: mode tiles, the showing theme's customization and its advanced options. */
import {
	type experimental_ThemeCustomization,
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
	const commit = () => (/^#[0-9a-f]{6}$/i.test(text) ? onChange(text.toLowerCase()) : setText(value));
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
				onKeyDown={(e) => experimental_shellServices().experimental_matches(e, "desktop.item.activate") && commit()}
				className="w-14 min-w-0 bg-transparent text-xs leading-4 outline-none focus-visible:outline-none"
			/>
		</span>
	);
}

/** Codex's "Import theme": paste a theme string; Import is enabled once it parses. */
function ImportThemeDialog({
	onImport,
	onClose,
}: {
	onImport: (custom: experimental_ThemeCustomization) => void;
	onClose: () => void;
}) {
	const [text, setText] = useState("");
	const parsed = experimental_appearance().experimental_parseThemeString(text);
	return (
		<Dialog title="Import theme" onClose={onClose}>
			<div className="pt-3">
				<input
					aria-label="Theme"
					value={text}
					spellCheck={false}
					placeholder='knightcode-theme-v1:{"accent":"#3566f0","background":"#181818"}'
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) =>
						parsed && experimental_shellServices().experimental_matches(e, "desktop.item.activate") && onImport(parsed)
					}
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

const accentOptions = () => [
	{ value: "default", label: "Default" },
	...experimental_appearance().experimental_accents.map((a) => ({ value: a.hex, label: a.name })),
	{ value: "custom", label: "Custom" },
];

/**
 * Appearance, as Codex's: the Mode tiles, then the theme's own customization (Codex keeps one per light and dark;
 * these rows edit the one showing): the theme with Import and Copy, Accent (Codex's choices or a custom colour),
 * Background, Foreground and Font.
 */
export function Appearance() {
	const prefs = services().experimental_usePreferences();
	const theme = experimental_appearance().experimental_useState().theme;
	const custom = prefs.appearance?.[theme] ?? {};
	const base = experimental_appearance().experimental_base(theme);
	const name = theme === "dark" ? "Dark" : "Light";
	const [importing, setImporting] = useState(false);
	const [fonts, setFonts] = useState<LocalFont[]>([]);
	useEffect(() => {
		// The installed fonts, as Codex lists them (Chromium's Local Font Access); the system font alone if refused.
		// The query can need a user gesture, so a refused one is tried again on the next press (opening a picker).
		let cancelled = false;
		const load = () =>
			experimental_appearance()
				.experimental_localFonts()
				.then(
					(found) => {
						if (!found) return false;
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
	const named = experimental_appearance().experimental_accents.find((a) => a.hex === custom.accent);
	const accentValue = !custom.accent ? "default" : named ? named.hex : "custom";
	const customized = Object.keys(custom).length > 0;
	const presets = experimental_appearance()
		.experimental_usePresets()
		.filter((preset) => preset.theme === theme);
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
											onChange={() => services().experimental_setPreference("theme", m.value)}
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
								void services()
									.experimental_copyText(experimental_appearance().experimental_themeString(custom))
									.then((ok) => ok && experimental_controllers().experimental_notify("Copied theme", "success"))
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
								...presets.map((preset) => ({ value: preset.id, label: preset.label })),
								...(customized ? [{ value: "custom", label: "Custom" }] : []),
							]}
							onChange={(v) =>
								v === "knightcode"
									? experimental_appearance().experimental_customize(theme, undefined)
									: v !== "custom" && experimental_appearance().experimental_applyPreset(v)
							}
						/>
					</Row>
					<Row compact title="Accent">
						{accentValue === "custom" ? (
							<ColorField
								label={`${name} custom accent color`}
								value={accent}
								onChange={(hex) => experimental_appearance().experimental_customize(theme, { accent: hex })}
							/>
						) : null}
						<PillMenu
							label={`${name} accent color`}
							mark={<Swatch color={accent} />}
							text={accentOptions().find((o) => o.value === accentValue)!.label}
							value={accentValue}
							options={accentOptions().map((o) => ({
								...o,
								icon:
									o.value === "custom" ? undefined : <Swatch color={o.value === "default" ? base.accent : o.value} />,
							}))}
							onChange={(v) =>
								experimental_appearance().experimental_customize(theme, {
									accent: v === "default" ? undefined : v === "custom" ? accent : v,
								})
							}
						/>
					</Row>
					<Row compact title="Background">
						<ColorField
							label={`${name} background color`}
							value={custom.background ?? base.background}
							onChange={(hex) => experimental_appearance().experimental_customize(theme, { background: hex })}
						/>
					</Row>
					<Row compact title="Foreground">
						<ColorField
							label={`${name} ink color`}
							value={custom.foreground ?? base.foreground}
							onChange={(hex) => experimental_appearance().experimental_customize(theme, { foreground: hex })}
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
							onChange={(v) =>
								experimental_appearance().experimental_customize(theme, {
									font: v === "system" ? undefined : v,
									fontStyle: undefined,
								})
							}
						/>
					</Row>
				</Box>
				{importing ? (
					<ImportThemeDialog
						onClose={() => setImporting(false)}
						onImport={(imported) => {
							setImporting(false);
							experimental_appearance().experimental_customize(theme, imported, true);
						}}
					/>
				) : null}
			</Section>
			<AdvancedAppearance fonts={fonts} />
		</>
	);
}
type LocalFont = { family: string; style: string; postscriptName: string };

/**
 * Appearance › Advanced, as Codex's (measured 2026-10-19): the UI and code sizes (window-wide); the showing theme's
 * UI font style, content and code fonts with their styles, translucent sidebar and contrast; then diff markers and
 * pointer cursors. A style picks one of the chosen family's faces, so it waits for a family.
 */
function AdvancedAppearance({ fonts }: { fonts: LocalFont[] }) {
	const prefs = services().experimental_usePreferences();
	const theme = experimental_appearance().experimental_useState().theme;
	const custom = prefs.appearance?.[theme] ?? {};
	const name = theme === "dark" ? "Dark" : "Light";
	const [open, setOpen] = useState(false);
	const families = [...new Set(fonts.map((f) => f.family))];
	const familyOptions = families.map((f) => ({ value: f, label: f }));
	const contrast = custom.contrast ?? experimental_appearance().experimental_defaultContrast;
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
				onChange={(v) => experimental_appearance().experimental_customize(theme, { [key]: v })}
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
								onChange={(px) => services().experimental_setPreference("uiFontSize", px === 14 ? undefined : px)}
							/>
						</Row>
						<Row title="Code font size" detail="Adjust the base size used for code across threads and diffs">
							<SizeField
								label="Code font size"
								value={prefs.codeFontSize ?? 12}
								min={10}
								max={16}
								onChange={(px) => services().experimental_setPreference("codeFontSize", px === 12 ? undefined : px)}
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
									experimental_appearance().experimental_customize(theme, {
										contentFont: v === "ui" ? undefined : v,
										contentFontStyle: undefined,
									})
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
									experimental_appearance().experimental_customize(theme, {
										codeFont: v === "system" ? undefined : v,
										codeFontStyle: undefined,
									})
								}
							/>
							{styleMenu("code font style", custom.codeFont, custom.codeFontStyle, "codeFontStyle")}
						</Row>
						<Row compact title="Translucent sidebar">
							<Switch
								label={`${name} translucent sidebar`}
								checked={custom.translucentSidebar === true}
								onChange={(on) =>
									experimental_appearance().experimental_customize(theme, { translucentSidebar: on || undefined })
								}
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
									experimental_appearance().experimental_customize(theme, {
										contrast: v === experimental_appearance().experimental_defaultContrast ? undefined : v,
									});
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
								onChange={(v) => services().experimental_setPreference("diffMarkers", v === "color" ? undefined : v)}
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
								onChange={(on) => services().experimental_setPreference("pointerCursors", on || undefined)}
							/>
						</Row>
					</Box>
				</div>
			) : null}
		</section>
	);
}
