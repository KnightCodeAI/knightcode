/**
 * Appearance customization (Settings › Appearance, after Codex's): an accent, a background, a foreground and a UI
 * font per theme. The palette is derived from the background and foreground as desktop-shell.md section 11.1 has it:
 * each surface steps from the background toward the foreground (or toward black) by a fixed fraction, each text,
 * border and ghost layer is the foreground at a fixed alpha. The fractions are fitted to the built-in tokens
 * (styles.css), so the default colours derive the built-in palette; nothing is derived until something is customized.
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
		// The app menus' hints and rules stay black at their alpha, as the system's light menus draw them.
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

// A CSS string ends early only at a quote, a backslash or a newline: an imported theme string must not add rules.
const quoted = (name: string) => `"${name.replace(/[\u0000-\u001f\u007f"\\]/g, "")}"`;

/** The CSS properties a customization sets on the window (none for an empty one). */
export function customTokens(theme: ThemeName, custom: Customization | undefined): Record<string, string> {
	const tokens: Record<string, string> = {};
	if (!custom) return tokens;
	if (custom.background || custom.foreground || custom.contrast !== undefined) {
		const background = parse(custom.background ?? BASE[theme].background);
		const foreground = parse(custom.foreground ?? BASE[theme].foreground);
		// Contrast scales the surface steps (not the solids, which sit at the foreground's end).
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
		// Text on the accent: whichever of near-black and white reads better on it.
		tokens["--kc-text-on-accent"] = luminance(accent) > 0.2 ? "#1a120c" : "#ffffff";
		// Everywhere Codex draws its accent (measured 2026-10-20): focus rings, switches and the contrast fill, the
		// unread dot; info icons, links and pressed toggles in a lighter (dark) or darker (light) shade over a 10% tint;
		// the user's bubble; the text selection. Mixes after Codex's (app-initial theme builder), fitted to its blue.
		// ponytail: at Codex's default contrast; follow custom.contrast if anyone notices.
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
	// A chosen face is reached through its @font-face alias (fontFaces), the family after it.
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
