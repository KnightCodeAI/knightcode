/**
 * Appearance customization (Settings › Appearance, after Codex's and Freebuff's): an accent, a background, a foreground,
 * and a UI font per theme, plus rich theme presets with wallpapers, frosted glass surfaces, and full token derivations.
 */

import type { Preferences } from "../shared/host-protocol.ts";

/** One theme's customization (host-protocol.ts, Preferences.appearance). */
export type Customization = NonNullable<NonNullable<Preferences["appearance"]>["dark"]>;

export type ThemeName = "dark" | "light";

/** The built-in background, foreground and accent (styles.css). */
export const BASE: Record<ThemeName, { background: string; foreground: string; accent: string }> = {
	dark: { background: "#181818", foreground: "#ffffff", accent: "#f97316" },
	light: { background: "#ffffff", foreground: "#1a1c1f", accent: "#ea580c" },
};

/** Codex's accent choices (its Accent menu, 2026-10-19); Default is the theme's own. */
export const ACCENTS = [
	{ name: "Blue", hex: "#3566f0" },
	{ name: "Green", hex: "#04bb9f" },
	{ name: "Yellow", hex: "#ffcc38" },
	{ name: "Pink", hex: "#fa70ab" },
	{ name: "Orange", hex: "#ff8066" },
	{ name: "Purple", hex: "#a25bff" },
	{ name: "White", hex: "#ffffff" },
] as const;

/**
 * A token's recipe: `mix` steps from the background toward the foreground (negative: toward black) by that fraction;
 * `ink` is the foreground at that alpha. `alpha` makes a mixed surface translucent.
 */
type Recipe = { mix: number; alpha?: number } | { ink: number };

const RECIPES: Record<ThemeName, Record<string, Recipe>> = {
	dark: {
		"--kc-bg-shell": { mix: 0.0346 },
		"--kc-bg-sidebar": { mix: 0.013 },
		"--kc-bg-surface": { mix: 0 },
		"--kc-bg-surface-secondary": { mix: -0.1667 },
		"--kc-bg-surface-tertiary": { mix: 0.0693 },
		"--kc-bg-elevated": { mix: 0.1299, alpha: 0.96 },
		"--kc-bg-panel": { mix: 0.0909 },
		"--kc-bg-section": { mix: 0.0476 },
		"--kc-bg-composer": { mix: 0.1299 },
		"--kc-bg-composer-bar": { mix: 0.0693 },
		"--kc-card-soft": { mix: 0.0909, alpha: 0.5 },
		"--kc-card-row": { mix: 0.026, alpha: 0.7 },
		"--kc-bg-menu": { mix: 0.0909, alpha: 0.9 },
		"--kc-bg-tooltip": { mix: 0.0909 },
		"--kc-text-tooltip": { ink: 1 },
		"--kc-field": { mix: 0.0909, alpha: 0.96 },
		"--kc-app-menu-bg": { mix: 0.0303 },
		"--kc-solid": { mix: 1 },
		"--kc-solid-hover": { mix: 0.9221 },
		"--kc-solid-active": { mix: 0.8485 },
		"--kc-text-on-solid": { mix: 0.0909 },
		"--kc-text-inverse": { mix: -0.4583 },
		"--kc-text": { ink: 1 },
		"--kc-text-secondary": { ink: 0.65 },
		"--kc-text-tertiary": { ink: 0.498 },
		"--kc-text-nav": { ink: 0.85 },
		"--kc-text-activity": { ink: 0.6 },
		"--kc-text-output": { ink: 0.7 },
		"--kc-border": { ink: 0.082 },
		"--kc-border-strong": { ink: 0.157 },
		"--kc-border-subtle": { ink: 0.043 },
		"--kc-ghost-hover": { ink: 0.08 },
		"--kc-ghost-active": { ink: 0.16 },
		"--kc-soft": { ink: 0.03 },
		"--kc-soft-alt": { ink: 0.05 },
		"--kc-track": { ink: 0.1 },
		"--kc-soft-hover": { ink: 0.16 },
		"--kc-soft-active": { ink: 0.2 },
		"--kc-outline-hover": { ink: 0.3 },
		"--kc-outline-fill-hover": { ink: 0.04 },
		"--kc-outline-fill-active": { ink: 0.06 },
		"--kc-code-chip": { ink: 0.107 },
		"--kc-app-menu-hint": { ink: 0.75 },
		"--kc-app-menu-rule": { ink: 0.157 },
	},
	light: {
		"--kc-bg-shell": { mix: 0.0524 },
		"--kc-bg-sidebar": { mix: 0.0349 },
		"--kc-bg-surface": { mix: 0 },
		"--kc-bg-surface-secondary": { mix: -0.0353 },
		"--kc-bg-surface-tertiary": { mix: 0 },
		"--kc-bg-elevated": { mix: 0, alpha: 0.96 },
		"--kc-bg-panel": { mix: 0 },
		"--kc-bg-section": { mix: 0 },
		"--kc-bg-composer": { mix: 0 },
		"--kc-bg-composer-bar": { mix: -0.0353 },
		"--kc-card-soft": { mix: 0, alpha: 0.5 },
		"--kc-card-row": { mix: -0.0353, alpha: 0.7 },
		"--kc-bg-menu": { mix: 0, alpha: 0.92 },
		"--kc-bg-tooltip": { mix: 1 },
		"--kc-text-tooltip": { mix: 0 },
		"--kc-field": { mix: 0, alpha: 0.96 },
		"--kc-app-menu-bg": { mix: 0 },
		"--kc-solid": { mix: 1 },
		"--kc-solid-hover": { mix: 0.904 },
		"--kc-solid-active": { mix: 0.8297 },
		"--kc-text-on-solid": { mix: 0 },
		"--kc-text-inverse": { mix: 0 },
		"--kc-text": { ink: 1 },
		"--kc-text-secondary": { ink: 0.65 },
		"--kc-text-tertiary": { ink: 0.494 },
		"--kc-text-nav": { ink: 0.85 },
		"--kc-text-activity": { ink: 0.6 },
		"--kc-text-output": { ink: 0.7 },
		"--kc-border": { ink: 0.08 },
		"--kc-border-strong": { ink: 0.118 },
		"--kc-border-subtle": { ink: 0.047 },
		"--kc-ghost-hover": { ink: 0.055 },
		"--kc-ghost-active": { ink: 0.12 },
		"--kc-soft": { ink: 0.02 },
		"--kc-soft-alt": { ink: 0.047 },
		"--kc-track": { ink: 0.08 },
		"--kc-soft-hover": { ink: 0.12 },
		"--kc-soft-active": { ink: 0.16 },
		"--kc-outline-hover": { ink: 0.2 },
		"--kc-outline-fill-hover": { ink: 0.02 },
		"--kc-outline-fill-active": { ink: 0.04 },
		"--kc-code-chip": { ink: 0.07 },
	},
};

type Rgb = [number, number, number];

const HEX = /^#([0-9a-f]{6})$/i;
export const isHex = (value: string) => HEX.test(value);
const parse = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const css = ([r, g, b]: Rgb, alpha = 1) =>
	`rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)}${alpha < 1 ? ` / ${alpha}` : ""})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rgb;

const luminance = (rgb: Rgb) => {
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const UI_FONTS = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CODE_FONTS = 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** Codex's contrast default; surfaces step from the background in proportion to the contrast over it. */
export const DEFAULT_CONTRAST = 60;

/** The three font slots: a family, a face of it, the token it sets, and the fonts after it. */
const FONT_SLOTS = [
	{ family: "font", face: "fontStyle", token: "--kc-font-ui", alias: "kc-ui-face", fallback: UI_FONTS },
	{
		family: "contentFont",
		face: "contentFontStyle",
		token: "--kc-font-content",
		alias: "kc-content-face",
		fallback: "var(--kc-font-ui)",
	},
	{ family: "codeFont", face: "codeFontStyle", token: "--kc-font-code", alias: "kc-code-face", fallback: CODE_FONTS },
] as const;

const quoted = (name: string) => `"${name.replace(/[\u0000-\u001f\u007f"\\]/g, "")}"`;

/** The CSS properties a customization sets on the window (none for an empty one). */
export function customTokens(theme: ThemeName, custom: Customization | undefined): Record<string, string> {
	const tokens: Record<string, string> = {};
	if (!custom) return tokens;
	if (custom.background || custom.foreground || custom.contrast !== undefined) {
		const background = parse(custom.background ?? BASE[theme].background);
		const foreground = parse(custom.foreground ?? BASE[theme].foreground);
		const scale = (custom.contrast ?? DEFAULT_CONTRAST) / DEFAULT_CONTRAST;
		for (const [name, recipe] of Object.entries(RECIPES[theme])) {
			if ("ink" in recipe) {
				tokens[name] = css(foreground, recipe.ink);
				continue;
			}
			const step = Math.abs(recipe.mix) < 0.5 ? recipe.mix * scale : recipe.mix;
			tokens[name] = css(
				step < 0 ? mix(background, [0, 0, 0], Math.min(1, -step)) : mix(background, foreground, Math.min(1, step)),
				recipe.alpha,
			);
		}
	}
	if (custom.accent) {
		const accent = parse(custom.accent);
		const white: Rgb = [255, 255, 255];
		const black: Rgb = [0, 0, 0];
		tokens["--kc-accent"] = css(accent);
		tokens["--kc-accent-hover"] = css(mix(accent, white, 0.16));
		tokens["--kc-text-on-accent"] = luminance(accent) > 0.2 ? "#1a120c" : "#ffffff";
		const dark = theme === "dark";
		const text = dark ? mix(accent, white, 0.39) : mix(accent, black, 0.2);
		tokens["--kc-focus"] = css(accent);
		tokens["--kc-switch-on"] = css(accent);
		tokens["--kc-info"] = css(text);
		tokens["--kc-info-bg"] = css(mix(parse(custom.background ?? BASE[theme].background), accent, 0.1));
		tokens["--kc-link"] = css(text);
		tokens["--kc-user-bubble"] = css(dark ? mix(black, accent, 0.48) : mix(white, accent, 0.12));
		tokens["--kc-user-bubble-text"] = css(dark ? mix(white, accent, 0.05) : mix(black, accent, 0.28));
		tokens["--kc-selection"] = css(dark ? text : accent, dark ? 0.4 : 0.3);
	}
	for (const slot of FONT_SLOTS) {
		const family = custom[slot.family];
		if (!family) continue;
		const face = custom[slot.face] ? `"${slot.alias}", ` : "";
		tokens[slot.token] = `${face}${quoted(family)}, ${slot.fallback}`;
	}
	return tokens;
}

/** The @font-face rules that name the chosen faces (by PostScript name) for customTokens's aliases. */
export function fontFaces(custom: Customization | undefined): string {
	if (!custom) return "";
	return FONT_SLOTS.filter((slot) => custom[slot.family] && custom[slot.face])
		.map((slot) => `@font-face { font-family: "${slot.alias}"; src: local(${quoted(custom[slot.face]!)}); }`)
		.join("\n");
}

/** Codex's theme string: a prefix and the customization as JSON, for Copy and Import theme. */
const PREFIX = "knightcode-theme-v1:";

export const themeString = (custom: Customization) => `${PREFIX}${JSON.stringify(custom)}`;

/** A pasted theme string's customization, keeping only well-formed fields; undefined if it is not one. */
export function parseThemeString(text: string): Customization | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith(PREFIX)) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(trimmed.slice(PREFIX.length));
	} catch {
		return undefined;
	}
	if (!value || typeof value !== "object") return undefined;
	const fields = value as Record<string, unknown>;
	const custom: Customization = {};
	for (const key of ["accent", "background", "foreground"] as const) {
		const field = fields[key];
		if (typeof field === "string" && isHex(field)) custom[key] = field.toLowerCase();
	}
	for (const key of ["font", "fontStyle", "contentFont", "contentFontStyle", "codeFont", "codeFontStyle"] as const) {
		const field = fields[key];
		if (typeof field === "string" && field.trim()) custom[key] = field.trim();
	}
	if (typeof fields.contrast === "number" && fields.contrast >= 0 && fields.contrast <= 100)
		custom.contrast = fields.contrast;
	if (typeof fields.translucentSidebar === "boolean") custom.translucentSidebar = fields.translucentSidebar;
	return custom;
}

// Oklab delta mapping based on Freebuff
const Sse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const nje = (n: number) => Math.max(0, Math.min(1, n));
const ije = (rgb: number[]) =>
	"#" +
	rgb
		.map((c) =>
			Math.round(nje(c) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("");
const _se = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rje = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function eE(hex: string): [number, number, number] {
	const [t, n, i] = Sse(hex).map(_se);
	const r = Math.cbrt(0.4122214708 * t! + 0.5363325363 * n! + 0.0514459929 * i!);
	const s = Math.cbrt(0.2119034982 * t! + 0.6806995451 * n! + 0.1073969566 * i!);
	const o = Math.cbrt(0.0883024619 * t! + 0.2817188376 * n! + 0.6299787005 * i!);
	return [
		0.2104542553 * r + 0.793617785 * s - 0.0040720468 * o,
		1.9779984951 * r - 2.428592205 * s + 0.4505937099 * o,
		0.0259040371 * r + 0.7827717662 * s - 0.808675766 * o,
	];
}

function sje([e, t, n]: [number, number, number]): string {
	const i = (e + 0.3963377774 * t + 0.2158037573 * n) ** 3;
	const r = (e - 0.1055613458 * t - 0.0638541728 * n) ** 3;
	const s = (e - 0.0894841775 * t - 1.291485548 * n) ** 3;
	return ije(
		[
			4.0767416621 * i - 3.3077115913 * r + 0.2309699292 * s,
			-1.2684380046 * i + 2.6097574011 * r - 0.3413193965 * s,
			-0.0041960863 * i - 0.7034186147 * r + 1.707614701 * s,
		].map(rje),
	);
}

export function oklabShift(targetHex: string, baseHex: string, tokenHex: string): string {
	if (targetHex.toLowerCase() === baseHex.toLowerCase()) return tokenHex;
	const i = eE(baseHex);
	const r = eE(targetHex);
	const s = eE(tokenHex);
	return sje(r.map((o, a) => o + s[a]! - i[a]!) as [number, number, number]);
}

export function isDarkSurface(surfaceHex: string): boolean {
	const rgb = [1, 3, 5].map((i) => parseInt(surfaceHex.slice(i, i + 2), 16)) as [number, number, number];
	const lum = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const l = 0.2126 * lum(rgb[0]) + 0.7152 * lum(rgb[1]) + 0.0722 * lum(rgb[2]);
	return l < 0.35;
}

export interface ThemeColors {
	surface: string;
	accent: string;
	text: string;
}

export interface ThemePresetWallpaper {
	source: string;
	opacity?: number;
	blur?: number;
	gradient?: {
		enabled: boolean;
		direction: string;
		position: number;
	};
}

export interface ThemePreset {
	id: string;
	name: string;
	description: string;
	builtin: boolean;
	mode: ThemeName | "system";
	colors: ThemeColors;
	wallpaper: ThemePresetWallpaper | null;
	dots: readonly [string, string, string, string];
	customization: Customization;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
	{
		id: "auto",
		name: "System",
		description: "Follows system appearance with dynamic light and dark adaptation",
		builtin: true,
		mode: "system",
		colors: {
			surface: "#181818",
			accent: "#f97316",
			text: "#ffffff",
		},
		wallpaper: null,
		dots: ["#ffffff", "#98d8aa", "#527853", "#1a202c"],
		customization: {},
	},
	{
		id: "dark",
		name: "Dark",
		description: "The default KnightCode dark theme with signature orange accent",
		builtin: true,
		mode: "dark",
		colors: {
			surface: "#181818",
			accent: "#f97316",
			text: "#ffffff",
		},
		wallpaper: null,
		dots: ["#f97316", "#262626", "#404040", "#181818"],
		customization: {},
	},
	{
		id: "light",
		name: "Light",
		description: "The clean KnightCode light theme for bright workspaces",
		builtin: true,
		mode: "light",
		colors: {
			surface: "#ffffff",
			accent: "#ea580c",
			text: "#1a1c1f",
		},
		wallpaper: null,
		dots: ["#ffffff", "#60a5fa", "#2563eb", "#1e293b"],
		customization: {},
	},
	{
		id: "og-shine",
		name: "OG Shine",
		description: "OG Shine theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#0a0a0a",
			accent: "#50ecb3",
			text: "#ebebeb",
		},
		wallpaper: null,
		dots: ["#50ecb3", "#ebebeb", "#0a0a0a", "#292b2a"],
		customization: {
			background: "#0a0a0a",
			foreground: "#ebebeb",
			accent: "#50ecb3",
			contrast: 65,
			translucentSidebar: false,
		},
	},
	{
		id: "alpine",
		name: "Alpine",
		description: "Alpine theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#152423",
			accent: "#a8d7ac",
			text: "#e2ede4",
		},
		wallpaper: {
			source: "/wallpapers/alpine-mist.webp",
			opacity: 0.72,
			blur: 8,
			gradient: {
				enabled: true,
				direction: "bottom",
				position: 0.66,
			},
		},
		dots: ["#a8d7ac", "#e2ede4", "#152423", "#292b2a"],
		customization: {
			background: "#152423",
			foreground: "#e2ede4",
			accent: "#a8d7ac",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "dune",
		name: "Dune",
		description: "Dune theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f4eee5",
			accent: "#ac613e",
			text: "#382b23",
		},
		wallpaper: {
			source: "/wallpapers/desert.webp",
			opacity: 0.77,
			blur: 5,
			gradient: {
				enabled: true,
				direction: "bottom",
				position: 0.58,
			},
		},
		dots: ["#ac613e", "#382b23", "#f4eee5", "#dfe5df"],
		customization: {
			background: "#f4eee5",
			foreground: "#382b23",
			accent: "#ac613e",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "tide",
		name: "Tide",
		description: "Tide theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#0e1d27",
			accent: "#73d4cd",
			text: "#dbe9ec",
		},
		wallpaper: {
			source: "/wallpapers/lagoon.webp",
			opacity: 0.74,
			blur: 10,
			gradient: {
				enabled: true,
				direction: "bottom",
				position: 0.56,
			},
		},
		dots: ["#73d4cd", "#dbe9ec", "#0e1d27", "#292b2a"],
		customization: {
			background: "#0e1d27",
			foreground: "#dbe9ec",
			accent: "#73d4cd",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "blossom",
		name: "Blossom",
		description: "Blossom theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f6eeee",
			accent: "#b4566f",
			text: "#3d292f",
		},
		wallpaper: {
			source: "/wallpapers/blossom.webp",
			opacity: 0.7,
			blur: 8,
			gradient: {
				enabled: true,
				direction: "left",
				position: 0.6,
			},
		},
		dots: ["#b4566f", "#3d292f", "#f6eeee", "#dfe5df"],
		customization: {
			background: "#f6eeee",
			foreground: "#3d292f",
			accent: "#b4566f",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "orbit",
		name: "Orbit",
		description: "Orbit theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#171624",
			accent: "#c2aff7",
			text: "#e9e5f7",
		},
		wallpaper: {
			source: "/wallpapers/orion.webp",
			opacity: 0.76,
			blur: 10,
			gradient: {
				enabled: true,
				direction: "right",
				position: 0.6,
			},
		},
		dots: ["#c2aff7", "#e9e5f7", "#171624", "#292b2a"],
		customization: {
			background: "#171624",
			foreground: "#e9e5f7",
			accent: "#c2aff7",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "after-rain",
		name: "After rain",
		description: "After rain theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#e9efeb",
			accent: "#557b71",
			text: "#1c312c",
		},
		wallpaper: {
			source: "/wallpapers/misty-forest.webp",
			opacity: 0.8,
			blur: 8,
			gradient: {
				enabled: true,
				direction: "bottom",
				position: 0.62,
			},
		},
		dots: ["#557b71", "#1c312c", "#e9efeb", "#dfe5df"],
		customization: {
			background: "#e9efeb",
			foreground: "#1c312c",
			accent: "#557b71",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "ember",
		name: "Ember",
		description: "Ember theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#1d1310",
			accent: "#f0a066",
			text: "#f3e5da",
		},
		wallpaper: {
			source: "/wallpapers/canyon.webp",
			opacity: 0.74,
			blur: 10,
			gradient: {
				enabled: true,
				direction: "right",
				position: 0.6,
			},
		},
		dots: ["#f0a066", "#f3e5da", "#1d1310", "#292b2a"],
		customization: {
			background: "#1d1310",
			foreground: "#f3e5da",
			accent: "#f0a066",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "kanagawa",
		name: "Kanagawa",
		description: "Kanagawa theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f2ebd9",
			accent: "#2f5d8c",
			text: "#1f2a38",
		},
		wallpaper: {
			source: "/wallpapers/great-wave.webp",
			opacity: 0.77,
			blur: 6,
			gradient: {
				enabled: true,
				direction: "right",
				position: 0.6,
			},
		},
		dots: ["#2f5d8c", "#1f2a38", "#f2ebd9", "#dfe5df"],
		customization: {
			background: "#f2ebd9",
			foreground: "#1f2a38",
			accent: "#2f5d8c",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "aurora",
		name: "Aurora",
		description: "Aurora theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#14141f",
			accent: "#8de0b5",
			text: "#e3e2ee",
		},
		wallpaper: {
			source: "/wallpapers/aurora.webp",
			opacity: 0.7,
			blur: 10,
			gradient: {
				enabled: true,
				direction: "top",
				position: 0.62,
			},
		},
		dots: ["#8de0b5", "#e3e2ee", "#14141f", "#292b2a"],
		customization: {
			background: "#14141f",
			foreground: "#e3e2ee",
			accent: "#8de0b5",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "frost",
		name: "Frost",
		description: "Frost theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#eaf0f6",
			accent: "#3c72ad",
			text: "#1c2a39",
		},
		wallpaper: {
			source: "/wallpapers/snow-ridge.webp",
			opacity: 0.78,
			blur: 0,
			gradient: {
				enabled: true,
				direction: "bottom",
				position: 0.62,
			},
		},
		dots: ["#3c72ad", "#1c2a39", "#eaf0f6", "#dfe5df"],
		customization: {
			background: "#eaf0f6",
			foreground: "#1c2a39",
			accent: "#3c72ad",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "nebula",
		name: "Nebula",
		description: "Nebula theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#0f141d",
			accent: "#f3a37a",
			text: "#e3e8f0",
		},
		wallpaper: {
			source: "/wallpapers/orion.webp",
			opacity: 0.74,
			blur: 0,
			gradient: {
				enabled: true,
				direction: "right",
				position: 0.6,
			},
		},
		dots: ["#f3a37a", "#e3e8f0", "#0f141d", "#292b2a"],
		customization: {
			background: "#0f141d",
			foreground: "#e3e8f0",
			accent: "#f3a37a",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "mirage",
		name: "Mirage",
		description: "Mirage theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f3ebdf",
			accent: "#b0603b",
			text: "#372921",
		},
		wallpaper: {
			source: "/wallpapers/desert.webp",
			opacity: 0.78,
			blur: 0,
			gradient: {
				enabled: true,
				direction: "bottom",
				position: 0.6,
			},
		},
		dots: ["#b0603b", "#372921", "#f3ebdf", "#dfe5df"],
		customization: {
			background: "#f3ebdf",
			foreground: "#372921",
			accent: "#b0603b",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "phosphor",
		name: "Phosphor",
		description: "Phosphor theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#101c18",
			accent: "#a8e7ac",
			text: "#d5efdc",
		},
		wallpaper: {
			source: "/wallpapers/alpine-mist.webp",
			opacity: 0.77,
			blur: 0,
			gradient: {
				enabled: true,
				direction: "bottom",
				position: 0.62,
			},
		},
		dots: ["#a8e7ac", "#d5efdc", "#101c18", "#292b2a"],
		customization: {
			background: "#101c18",
			foreground: "#d5efdc",
			accent: "#a8e7ac",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "violet-hour",
		name: "Violet hour",
		description: "Violet hour theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#eceaf5",
			accent: "#7560ae",
			text: "#2e2842",
		},
		wallpaper: {
			source: "/wallpapers/spectrum.webp",
			opacity: 0.65,
			blur: 16,
			gradient: {
				enabled: true,
				direction: "top",
				position: 0.7,
			},
		},
		dots: ["#7560ae", "#2e2842", "#eceaf5", "#dfe5df"],
		customization: {
			background: "#eceaf5",
			foreground: "#2e2842",
			accent: "#7560ae",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "carbon",
		name: "Carbon",
		description: "Carbon theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#191a1f",
			accent: "#9daecc",
			text: "#e1e3e9",
		},
		wallpaper: null,
		dots: ["#9daecc", "#e1e3e9", "#191a1f", "#292b2a"],
		customization: {
			background: "#191a1f",
			foreground: "#e1e3e9",
			accent: "#9daecc",
			contrast: 65,
			translucentSidebar: false,
		},
	},
	{
		id: "paper",
		name: "Paper",
		description: "Paper theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f1ede3",
			accent: "#8c6950",
			text: "#312d26",
		},
		wallpaper: null,
		dots: ["#8c6950", "#312d26", "#f1ede3", "#dfe5df"],
		customization: {
			background: "#f1ede3",
			foreground: "#312d26",
			accent: "#8c6950",
			contrast: 65,
			translucentSidebar: false,
		},
	},
	{
		id: "daybreak",
		name: "Daybreak",
		description: "Daybreak theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f2f4f9",
			accent: "#3f6fc4",
			text: "#1f2a40",
		},
		wallpaper: {
			source: "gradient:radial:#ffe6c7,#e4dcf7,#a9c2f0",
			opacity: 0.62,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#3f6fc4", "#1f2a40", "#f2f4f9", "#dfe5df"],
		customization: {
			background: "#f2f4f9",
			foreground: "#1f2a40",
			accent: "#3f6fc4",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "dusk",
		name: "Dusk",
		description: "Dusk theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#171220",
			accent: "#ffb38a",
			text: "#f3e7e1",
		},
		wallpaper: {
			source: "gradient:radial:#e2725b,#8e3b6e,#1d1430",
			opacity: 0.68,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#ffb38a", "#f3e7e1", "#171220", "#292b2a"],
		customization: {
			background: "#171220",
			foreground: "#f3e7e1",
			accent: "#ffb38a",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "graphite",
		name: "Graphite",
		description: "Graphite theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#14161c",
			accent: "#c9d1e0",
			text: "#e4e7ee",
		},
		wallpaper: {
			source: "gradient:linear:#3a4150,#272c37,#15181f",
			opacity: 0.68,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#c9d1e0", "#e4e7ee", "#14161c", "#292b2a"],
		customization: {
			background: "#14161c",
			foreground: "#e4e7ee",
			accent: "#c9d1e0",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "lilac",
		name: "Lilac",
		description: "Lilac theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f4f1fb",
			accent: "#6c55c4",
			text: "#2b2440",
		},
		wallpaper: {
			source: "gradient:mesh:#dccdfb,#c6d5fb,#f5d6ee",
			opacity: 0.68,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#6c55c4", "#2b2440", "#f4f1fb", "#dfe5df"],
		customization: {
			background: "#f4f1fb",
			foreground: "#2b2440",
			accent: "#6c55c4",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "midnight",
		name: "Midnight",
		description: "Midnight theme preset",
		builtin: false,
		mode: "dark",
		colors: {
			surface: "#11121d",
			accent: "#a5b4ff",
			text: "#e6e8f5",
		},
		wallpaper: {
			source: "gradient:mesh:#2b2f7a,#5a2f7e,#0f5368",
			opacity: 0.68,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#a5b4ff", "#e6e8f5", "#11121d", "#292b2a"],
		customization: {
			background: "#11121d",
			foreground: "#e6e8f5",
			accent: "#a5b4ff",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "peach",
		name: "Peach",
		description: "Peach theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#fbf2ee",
			accent: "#d2604a",
			text: "#3a2621",
		},
		wallpaper: {
			source: "gradient:mesh:#ffd2c2,#ffc4d6,#fde6c4",
			opacity: 0.68,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#d2604a", "#3a2621", "#fbf2ee", "#dfe5df"],
		customization: {
			background: "#fbf2ee",
			foreground: "#3a2621",
			accent: "#d2604a",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "seafoam",
		name: "Seafoam",
		description: "Seafoam theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#eef6f2",
			accent: "#2a8a6e",
			text: "#1b362e",
		},
		wallpaper: {
			source: "gradient:linear:#c6efe0,#d6ecf6,#f3f6df",
			opacity: 0.68,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#2a8a6e", "#1b362e", "#eef6f2", "#dfe5df"],
		customization: {
			background: "#eef6f2",
			foreground: "#1b362e",
			accent: "#2a8a6e",
			contrast: 65,
			translucentSidebar: true,
		},
	},
	{
		id: "sherbet",
		name: "Sherbet",
		description: "Sherbet theme preset",
		builtin: false,
		mode: "light",
		colors: {
			surface: "#f8f2f4",
			accent: "#d1557b",
			text: "#38222c",
		},
		wallpaper: {
			source: "gradient:linear:#ffd9a8,#ffb3c7,#b9c6ff",
			opacity: 0.7,
			blur: 0,
			gradient: {
				enabled: false,
				direction: "bottom",
				position: 0.5,
			},
		},
		dots: ["#d1557b", "#38222c", "#f8f2f4", "#dfe5df"],
		customization: {
			background: "#f8f2f4",
			foreground: "#38222c",
			accent: "#d1557b",
			contrast: 65,
			translucentSidebar: true,
		},
	},
];

export function freebuffTokens(preset: ThemePreset, resolvedTheme: ThemeName = "dark"): Record<string, string> {
	const dark = preset.mode === "system" ? resolvedTheme === "dark" : preset.mode === "dark";
	const isAuto = preset.id === "auto";
	const surface = isAuto ? (dark ? BASE.dark.background : BASE.light.background) : preset.colors.surface;
	const accent = isAuto ? (dark ? BASE.dark.accent : BASE.light.accent) : preset.colors.accent;
	const text = isAuto ? (dark ? BASE.dark.foreground : BASE.light.foreground) : preset.colors.text;

	const baseDark = { surface: "#1c1d1c", accent: "#b5cea5", text: "#dedfdd" };
	const baseLight = { surface: "#f0f2ef", accent: "#b5cea5", text: "#232b26" };
	const base = dark ? baseDark : baseLight;
	const hasWallpaper = Boolean(preset.wallpaper?.source);

	const shellBase = oklabShift(surface, base.surface, dark ? "#292b2a" : "#e3e7e4");
	const surfaceMain = oklabShift(surface, base.surface, dark ? "#222423" : "#f7f8f5");
	const surface2 = oklabShift(surface, base.surface, dark ? "#282a29" : "#e9ede8");
	const raised = oklabShift(surface, base.surface, dark ? "#303330" : "#dfe5df");
	const composerBg = oklabShift(surface, base.surface, dark ? "#2e332f" : "#edf2ec");

	const textMain = text;
	const textMuted = oklabShift(text, base.text, dark ? "#a0a39f" : "#5d6962");
	const textFaint = oklabShift(text, base.text, dark ? "#858984" : "#667168");

	const tokens: Record<string, string> = {
		"--kc-accent": accent,
		"--kc-accent-hover": `color-mix(in srgb, ${accent} 85%, white)`,
		"--kc-focus": accent,
		"--kc-switch-on": accent,
		"--kc-selection": `color-mix(in srgb, ${accent} 35%, transparent)`,
		"--kc-text-on-accent": luminance(parse(accent)) > 0.35 ? "#111111" : "#ffffff",
		"--kc-solid": accent,
		"--kc-solid-hover": `color-mix(in srgb, ${accent} 90%, white)`,
		"--kc-solid-active": `color-mix(in srgb, ${accent} 80%, black)`,
		"--kc-text-on-solid": luminance(parse(accent)) > 0.35 ? "#111111" : "#ffffff",
		"--kc-user-bubble": accent,
		"--kc-user-bubble-text": "#ffffff",

		"--kc-text": textMain,
		"--kc-text-secondary": textMuted,
		"--kc-text-tertiary": textFaint,
		"--kc-text-nav": `color-mix(in srgb, ${textMain} 85%, transparent)`,
		"--kc-text-activity": `color-mix(in srgb, ${textMain} 60%, transparent)`,
		"--kc-text-output": `color-mix(in srgb, ${textMain} 70%, transparent)`,

		"--kc-border": `color-mix(in srgb, ${textMain} 8%, transparent)`,
		"--kc-border-strong": `color-mix(in srgb, ${textMain} 16%, transparent)`,
		"--kc-border-subtle": `color-mix(in srgb, ${textMain} 4%, transparent)`,

		"--kc-ghost-hover": `color-mix(in srgb, ${textMain} 8%, transparent)`,
		"--kc-ghost-active": `color-mix(in srgb, ${textMain} 16%, transparent)`,
		"--kc-soft": `color-mix(in srgb, ${textMain} 3%, transparent)`,
		"--kc-soft-hover": `color-mix(in srgb, ${textMain} 14%, transparent)`,
		"--kc-soft-active": `color-mix(in srgb, ${textMain} 18%, transparent)`,
	};

	if (hasWallpaper) {
		const opacity = preset.wallpaper?.opacity ?? 0.72;
		const surfacePct = Math.round(opacity * 100);
		tokens["--kc-surface-solid"] = surface;
		tokens["--kc-bg-shell"] = "transparent";
		tokens["--kc-bg-sidebar"] = "transparent";
		tokens["--kc-bg-surface"] = `color-mix(in srgb, ${surfaceMain} ${surfacePct}%, transparent)`;
		tokens["--kc-bg-surface-secondary"] =
			`color-mix(in srgb, ${surface2} ${Math.min(100, surfacePct + 5)}%, transparent)`;
		tokens["--kc-bg-surface-tertiary"] =
			`color-mix(in srgb, ${raised} ${Math.min(100, surfacePct + 10)}%, transparent)`;
		tokens["--kc-bg-elevated"] = `color-mix(in srgb, ${raised} 92%, transparent)`;
		tokens["--kc-bg-panel"] = `color-mix(in srgb, ${surface2} ${Math.min(100, surfacePct + 10)}%, transparent)`;
		tokens["--kc-bg-section"] = `color-mix(in srgb, ${surface2} ${surfacePct}%, transparent)`;
		tokens["--kc-bg-composer"] = `color-mix(in srgb, ${composerBg} 75%, transparent)`;
		tokens["--kc-bg-composer-bar"] = `color-mix(in srgb, ${surface2} 75%, transparent)`;
		tokens["--kc-card-soft"] = `color-mix(in srgb, ${surface2} 50%, transparent)`;
		tokens["--kc-card-row"] = `color-mix(in srgb, ${surface} 60%, transparent)`;
		tokens["--kc-bg-menu"] = `color-mix(in srgb, ${raised} 92%, transparent)`;
		tokens["--kc-bg-tooltip"] = `color-mix(in srgb, ${raised} 94%, transparent)`;
		tokens["--kc-text-tooltip"] = textMain;
		tokens["--kc-field"] = `color-mix(in srgb, ${surface2} 75%, transparent)`;
		tokens["--kc-workspace-glass"] = `color-mix(in srgb, ${surface} ${surfacePct}%, transparent)`;
		tokens["--wallpaper-opacity"] = `${surfacePct}%`;
		tokens["--wallpaper-blur"] = `${preset.wallpaper?.blur ?? 8}px`;
	} else {
		tokens["--kc-bg-shell"] = shellBase;
		tokens["--kc-bg-sidebar"] = surface;
		tokens["--kc-bg-surface"] = surfaceMain;
		tokens["--kc-bg-surface-secondary"] = surface2;
		tokens["--kc-bg-surface-tertiary"] = raised;
		tokens["--kc-bg-elevated"] = raised;
		tokens["--kc-bg-panel"] = surface2;
		tokens["--kc-bg-section"] = surface2;
		tokens["--kc-bg-composer"] = composerBg;
		tokens["--kc-bg-composer-bar"] = surface2;
		tokens["--kc-card-soft"] = `color-mix(in srgb, ${surface2} 50%, transparent)`;
		tokens["--kc-card-row"] = `color-mix(in srgb, ${surface} 70%, transparent)`;
		tokens["--kc-bg-menu"] = raised;
		tokens["--kc-bg-tooltip"] = raised;
		tokens["--kc-text-tooltip"] = textMain;
		tokens["--kc-field"] = surface2;
	}

	return tokens;
}

function s9(e: { position: number }) {
	const t = e.position * 140 - 20;
	return Array.from({ length: 17 }, (_, i) => {
		const r = i / 16;
		return {
			position: Number((t - 45 + r * 90).toFixed(2)),
			alpha: Math.round(r * r * (3 - 2 * r) * 255) / 255,
		};
	});
}

export function renderGradientOverlay(
	surfaceColor: string,
	gradient?: { enabled: boolean; direction: string; position: number },
): string {
	if (!gradient?.enabled) return "none";
	const dirMap: Record<string, string> = {
		left: "to right",
		right: "to left",
		top: "to bottom",
		bottom: "to top",
	};
	const dir = dirMap[gradient.direction] ?? "to top";
	const stops = s9(gradient).map(({ position, alpha }) => {
		const hexAlpha = Math.round(alpha * 255)
			.toString(16)
			.padStart(2, "0");
		return `${surfaceColor}${hexAlpha} ${position.toFixed(2)}%`;
	});
	return `linear-gradient(${dir}, ${stops.join(", ")})`;
}

export function parseSourceGradient(source: string): { style: string; colors: string[] } | null {
	if (!source.startsWith("gradient:")) return null;
	const parts = source.slice("gradient:".length).split(":");
	if (parts.length < 2) return null;
	const style = parts[0]!.toLowerCase();
	const colors = parts[1]!.split(",").map((c) => c.trim().toLowerCase());
	return { style, colors };
}

export function renderSourceGradient(source: string): string {
	const parsed = parseSourceGradient(source);
	if (!parsed || parsed.colors.length === 0) return "none";
	const { style, colors } = parsed;
	if (style === "linear") {
		return `linear-gradient(135deg, ${colors[0] ?? "#000"} 0%, ${colors[1] ?? colors[0] ?? "#333"} 50%, ${colors[2] ?? colors[1] ?? "#666"} 100%)`;
	}
	if (style === "radial") {
		return `radial-gradient(circle at 50% 40%, ${colors[0] ?? "#fff"} 0%, ${colors[1] ?? colors[0] ?? "#888"} 55%, ${colors[2] ?? colors[1] ?? "#000"} 100%)`;
	}
	if (style === "mesh") {
		const c0 = colors[0] ?? "#444";
		const c1 = colors[1] ?? "#666";
		const c2 = colors[2] ?? "#888";
		return `radial-gradient(at 0% 0%, ${c0} 0px, transparent 55%), radial-gradient(at 100% 0%, ${c1} 0px, transparent 55%), radial-gradient(at 100% 100%, ${c2} 0px, transparent 65%), ${c0}`;
	}
	return "none";
}
