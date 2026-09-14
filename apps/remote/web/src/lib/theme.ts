export type Theme = "system" | "light" | "dark";

export const THEMES: ReadonlyArray<{ value: Theme; label: string }> = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

/** Also read by the inline script in index.html, which applies the choice before first paint. */
const KEY = "kc-theme";

/** The page ground per theme, mirrored on the theme-color meta so the status bar matches. */
const GROUND: Record<"light" | "dark", string> = { dark: "#0c0c0d", light: "#f4f4f5" };

export function readTheme(): Theme {
	try {
		const stored = localStorage.getItem(KEY);
		return stored === "light" || stored === "dark" ? stored : "system";
	} catch {
		return "system";
	}
}

export function applyTheme(theme: Theme): void {
	try {
		if (theme === "system") localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, theme);
	} catch {
		// Private mode or blocked storage: the choice still applies for this page view.
	}
	const root = document.documentElement;
	if (theme === "system") delete root.dataset.theme;
	else root.dataset.theme = theme;
	// The two metas are media-gated for "system"; an explicit choice pins both to its ground.
	for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
		const own = meta.media.includes("dark") ? "dark" : "light";
		meta.content = GROUND[theme === "system" ? own : theme];
	}
}
