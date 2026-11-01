// Design tokens for KnightCode Bots: measured values only, for both themes. tokens/css.ts turns them into CSS variables.

export type Theme = "dark" | "light";

/** Surface, text, border and accent colours. Every theme has the same keys. */
export const colors = {
	dark: {
		page: "rgb(18, 18, 18)",
		sidebar: "rgb(14, 14, 14)",
		surface: "rgb(31, 31, 31)",
		text: "rgb(245, 245, 245)",
		textStrong: "rgb(255, 255, 255)",
		textIcon: "rgba(245, 245, 245, 0.9)",
		textSecondary: "rgba(245, 245, 245, 0.66)",
		textClose: "rgba(245, 245, 245, 0.64)",
		textTertiary: "rgba(245, 245, 245, 0.54)",
		textDisabled: "rgba(245, 245, 245, 0.3)",
		textPlaceholder: "rgb(133, 133, 133)",
		textInverted: "rgb(18, 18, 18)",
		fill: "rgba(245, 245, 245, 0.04)",
		fillHover: "rgba(245, 245, 245, 0.06)",
		fillActive: "rgba(245, 245, 245, 0.08)",
		fillStrong: "rgba(245, 245, 245, 0.13)",
		inverse: "rgb(245, 245, 245)",
		/** Primary buttons inside dialogs. */
		inverseStrong: "rgb(245, 245, 245)",
		sheen: "rgba(255, 255, 255, 0.03)",
		border: "rgba(245, 245, 245, 0.1)",
		borderSubtle: "rgba(245, 245, 245, 0.06)",
		borderFaint: "rgba(245, 245, 245, 0.04)",
		borderStrong: "rgba(245, 245, 245, 0.22)",
		borderDisabled: "rgba(195, 195, 195, 0.3)",
		accent: "rgb(17, 109, 210)",
		danger: "rgb(255, 100, 99)",
		scrim: "rgba(0, 0, 0, 0.698)",
		/** The hairline beside the desktop window controls. */
		windowDivider: "rgba(245, 245, 245, 0.16)",
		/** Ink on small status marks (the main bot dot). */
		markInk: "rgb(245, 245, 245)",
		onAccent: "rgb(255, 255, 255)",
	},
	light: {
		page: "rgb(252, 252, 252)",
		sidebar: "rgb(245, 245, 245)",
		surface: "rgb(255, 255, 255)",
		text: "rgb(28, 28, 28)",
		textStrong: "rgb(0, 0, 0)",
		textIcon: "rgba(28, 28, 28, 0.92)",
		textSecondary: "rgba(28, 28, 28, 0.68)",
		textClose: "rgba(28, 28, 28, 0.66)",
		textTertiary: "rgba(28, 28, 28, 0.56)",
		textDisabled: "rgba(28, 28, 28, 0.3)",
		textPlaceholder: "rgb(118, 118, 118)",
		textInverted: "rgb(252, 252, 252)",
		fill: "rgba(28, 28, 28, 0.06)",
		fillHover: "rgba(28, 28, 28, 0.06)",
		fillActive: "rgba(28, 28, 28, 0.08)",
		fillStrong: "rgba(28, 28, 28, 0.15)",
		inverse: "rgb(28, 28, 28)",
		/** Primary buttons inside dialogs. */
		inverseStrong: "rgb(5, 5, 5)",
		sheen: "rgba(255, 255, 255, 0.16)",
		border: "rgba(28, 28, 28, 0.12)",
		borderSubtle: "rgba(28, 28, 28, 0.08)",
		borderFaint: "rgba(28, 28, 28, 0.06)",
		borderStrong: "rgba(28, 28, 28, 0.24)",
		borderDisabled: "rgba(118, 118, 118, 0.3)",
		accent: "rgb(22, 128, 243)",
		danger: "rgb(207, 43, 53)",
		scrim: "rgba(0, 0, 0, 0.5)",
		/** The hairline beside the desktop window controls. */
		windowDivider: "rgba(28, 28, 28, 0.16)",
		/** Ink on small status marks (the main bot dot). */
		markInk: "rgb(255, 255, 255)",
		onAccent: "rgb(255, 255, 255)",
	},
} as const satisfies Record<Theme, Record<string, string>>;

export type ColorToken = keyof (typeof colors)["dark"];

/** The eleven avatar colours, in picker order, per theme. */
export const avatarColors = {
	dark: {
		black: "rgb(255, 255, 255)",
		brown: "rgb(161, 107, 57)",
		red: "rgb(252, 44, 62)",
		orange: "rgb(249, 103, 14)",
		yellow: "rgb(246, 148, 18)",
		green: "rgb(20, 195, 112)",
		cyan: "rgb(19, 184, 163)",
		blue: "rgb(24, 132, 252)",
		violet: "rgb(144, 90, 251)",
		magenta: "rgb(251, 52, 153)",
		gray: "rgb(119, 119, 119)",
	},
	light: {
		black: "rgb(0, 0, 0)",
		brown: "rgb(160, 107, 57)",
		red: "rgb(251, 43, 62)",
		orange: "rgb(253, 105, 15)",
		yellow: "rgb(245, 147, 18)",
		green: "rgb(20, 193, 111)",
		cyan: "rgb(19, 183, 162)",
		blue: "rgb(30, 134, 252)",
		violet: "rgb(143, 89, 249)",
		magenta: "rgb(249, 52, 152)",
		gray: "rgb(149, 149, 149)",
	},
} as const satisfies Record<Theme, Record<string, string>>;

export type AvatarColor = keyof (typeof avatarColors)["dark"];

/** Spacing steps in pixels, keyed by their value. */
export const space = {
	0: "0px",
	2: "2px",
	4: "4px",
	6: "6px",
	7: "7px",
	8: "8px",
	9: "9px",
	10: "10px",
	12: "12px",
	14: "14px",
	16: "16px",
	20: "20px",
	22: "22px",
	24: "24px",
	32: "32px",
	54: "54px",
	100: "100px",
} as const;

export const radii = {
	xs: "6px",
	sm: "8px",
	md: "10px",
	lg: "12px",
	dialog: "14px",
	menu: "16px",
	bubble: "18px",
	composer: "22px",
	card: "24px",
	full: "9999px",
	circle: "50%",
	/** A message bubble's corner next to the speaker. */
	bubbleTail: "18px 18px 18px 6px",
} as const;

export const fontSizes = { xs: "12px", sm: "13px", md: "14px", lg: "15px", root: "16px", xl: "17px" } as const;
export const lineHeights = {
	xxs: "12px",
	xs: "16px",
	sm: "18px",
	md: "20px",
	lg: "22px",
	xl: "24px",
	normal: "normal",
} as const;
export const fontWeights = { regular: 400, medium: 500, semibold: 600 } as const;

/** Tracking as a fraction of the font size, as measured: most text uses 1%, small controls 1.5%. */
export const letterSpacings = {
	base: "0.01em",
	wide: "0.015em",
	tight: "-0.08px",
	title: "-0.15px",
	/** Pill tabs: the open font runs about 2% wider than the reference at 13 px, and these labels are measured to the pixel. */
	tab: "0.1px",
} as const;

/**
 * The open font chosen to match the reference text metrics (same line widths within 1% on measured samples),
 * with a system fallback stack.
 */
export const fonts = {
	sans: "'Libre Franklin Variable', 'Libre Franklin', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
	mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace",
	/** OpenType features every text run turns on. */
	features: '"calt", "case"',
} as const;

/** Named text styles: size, line height, weight and tracking that the screens use together. */
export const textStyles = {
	caption: { size: fontSizes.xs, line: lineHeights.xs, weight: fontWeights.regular, tracking: letterSpacings.base },
	captionStrong: {
		size: fontSizes.xs,
		line: lineHeights.xs,
		weight: fontWeights.medium,
		tracking: letterSpacings.base,
	},
	control: { size: fontSizes.sm, line: lineHeights.sm, weight: fontWeights.regular, tracking: letterSpacings.wide },
	controlStrong: {
		size: fontSizes.sm,
		line: lineHeights.sm,
		weight: fontWeights.medium,
		tracking: letterSpacings.wide,
	},
	body: { size: fontSizes.md, line: lineHeights.md, weight: fontWeights.regular, tracking: letterSpacings.base },
	bodyStrong: { size: fontSizes.md, line: lineHeights.md, weight: fontWeights.medium, tracking: letterSpacings.base },
	message: { size: fontSizes.lg, line: lineHeights.lg, weight: fontWeights.regular, tracking: letterSpacings.base },
	messageStrong: {
		size: fontSizes.lg,
		line: lineHeights.lg,
		weight: fontWeights.semibold,
		tracking: letterSpacings.base,
	},
	dialogTitle: {
		size: fontSizes.md,
		line: lineHeights.lg,
		weight: fontWeights.semibold,
		tracking: letterSpacings.title,
	},
	pageTitle: { size: fontSizes.xl, line: lineHeights.xl, weight: fontWeights.medium, tracking: letterSpacings.base },
} as const;

/** Shadows per theme. Rings and insets draw hairline edges; elevations lift popovers and the composer. */
export const shadows = {
	dark: {
		composer:
			"rgba(0, 0, 0, 0.05) 0px 2px 8px -1px, rgba(0, 0, 0, 0.03) 0px 1px 2px 0px, rgba(228, 228, 228, 0.04) 0px 0px 0px 1px",
		card: "rgba(245, 245, 245, 0.1) 0px 0px 0px 0.5px, rgba(245, 245, 245, 0) 0px 2px 8px 0px",
		control: "rgba(245, 245, 245, 0.06) 0px 0px 0px 0.5px inset",
		controlFaint: "rgba(245, 245, 245, 0.04) 0px 0px 0px 0.5px inset",
		button: "rgba(245, 245, 245, 0.15) 0px 0px 0px 0.5px inset",
		buttonDisabled: "rgba(245, 245, 245, 0.045) 0px 0px 0px 0.5px inset",
		bubble:
			"rgba(255, 255, 255, 0.03) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.03) 0px -0.5px 0px 0px inset, rgba(245, 245, 245, 0.04) 0px 0px 0px 0.5px inset",
		swatchRing: "rgb(31, 31, 31) 0px 0px 0px 3px, rgba(245, 245, 245, 0.22) 0px 0px 0px 4px",
		menu: "rgba(245, 245, 245, 0) 0px 10px 20px -3px, rgba(245, 245, 245, 0) 0px 4px 6px -4px, rgba(245, 245, 245, 0) 0px 0px 0px 1px",
		menuRing: "rgba(245, 245, 245, 0.1) 0px 0px 0px 0.5px inset, rgb(31, 31, 31) 0px 0px 0px 0.5px inset",
		popover:
			"rgba(245, 245, 245, 0) 0px 4px 12px -1px, rgba(245, 245, 245, 0) 0px 2px 4px -2px, rgba(245, 245, 245, 0) 0px 0px 0px 1px",
	},
	light: {
		composer:
			"rgba(0, 0, 0, 0.05) 0px 2px 8px -1px, rgba(0, 0, 0, 0.03) 0px 1px 2px 0px, rgba(228, 228, 228, 0.04) 0px 0px 0px 1px",
		card: "rgba(28, 28, 28, 0.12) 0px 0px 0px 0.5px, rgba(28, 28, 28, 0.035) 0px 2px 8px 0px",
		control: "rgba(28, 28, 28, 0.08) 0px 0px 0px 0.5px inset",
		controlFaint: "rgba(28, 28, 28, 0.06) 0px 0px 0px 0.5px inset",
		button: "rgba(28, 28, 28, 0.15) 0px 0px 0px 0.5px inset",
		buttonDisabled: "rgba(28, 28, 28, 0.045) 0px 0px 0px 0.5px inset",
		bubble:
			"rgba(255, 255, 255, 0.16) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.16) 0px -0.5px 0px 0px inset, rgba(28, 28, 28, 0.06) 0px 0px 0px 0.5px inset",
		swatchRing: "rgb(255, 255, 255) 0px 0px 0px 3px, rgba(28, 28, 28, 0.24) 0px 0px 0px 4px",
		menu: "rgba(28, 28, 28, 0.1) 0px 10px 20px -3px, rgba(28, 28, 28, 0.1) 0px 4px 6px -4px, rgba(28, 28, 28, 0.004) 0px 0px 0px 1px",
		menuRing: "rgba(28, 28, 28, 0.12) 0px 0px 0px 0.5px inset, rgb(255, 255, 255) 0px 0px 0px 0.5px inset",
		popover:
			"rgba(28, 28, 28, 0.08) 0px 4px 12px -1px, rgba(28, 28, 28, 0.06) 0px 2px 4px -2px, rgba(28, 28, 28, 0.004) 0px 0px 0px 1px",
	},
} as const satisfies Record<Theme, Record<string, string>>;

export const durations = {
	press: "50ms",
	fast: "100ms",
	hover: "120ms",
	base: "150ms",
	enter: "200ms",
	pane: "300ms",
} as const;

export const easings = {
	/** Dialogs, menus and tooltips entering; press feedback. */
	out: "cubic-bezier(0.165, 0.84, 0.44, 1)",
	/** Panes and the sidebar resizing. */
	standard: "cubic-bezier(0.2, 0, 0, 1)",
	/** Fading controls in and out. */
	fade: "cubic-bezier(0.22, 1, 0.36, 1)",
	/** Hover colour changes. */
	hover: "ease-out",
	/** A spring with no overshoot, for heights and widths that grow. */
	spring:
		"linear(0 0%, 0.01588 2%, 0.05618 4%, 0.11201 6%, 0.1768 8%, 0.2458 10%, 0.31562 12%, 0.38392 14%, 0.44914 16%, 0.51029 18%, 0.56683 20%, 0.61852 22%, 0.66534 24%, 0.70743 26%, 0.74501 28%, 0.77838 30%, 0.80788 32%, 0.83383 34%, 0.85658 36%, 0.87645 38%, 0.89376 40%, 0.92183 44%, 0.94282 48%, 0.95838 52%, 0.96984 56%, 0.97823 60%, 0.98435 64%, 0.98878 68%, 0.99198 72%, 0.99594 80%, 0.99829 90%, 1 100%)",
} as const;

/** Fixed layout sizes of the shell. */
export const layout = {
	sidebar: "280px",
	infoPane: "358px",
	toolbar: "60px",
	transcript: "960px",
	message: "560px",
	iconButton: "36px",
	settingsDialog: { width: "900px", height: "702px" },
	createDialog: { width: "440px" },
} as const;
