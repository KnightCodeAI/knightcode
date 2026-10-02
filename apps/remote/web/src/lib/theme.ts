import { useSyncExternalStore } from "react";

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

const PREFERS_LIGHT = "(prefers-color-scheme: light)";

/** The theme on screen: the explicit choice on <html>, else the OS preference (dark by default, as in index.css). */
function resolvedTheme(): "light" | "dark" {
	const chosen = document.documentElement.dataset.theme;
	if (chosen === "light" || chosen === "dark") return chosen;
	return matchMedia(PREFERS_LIGHT).matches ? "light" : "dark";
}

function subscribeTheme(onChange: () => void): () => void {
	const media = matchMedia(PREFERS_LIGHT);
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
	media.addEventListener("change", onChange);
	return () => {
		observer.disconnect();
		media.removeEventListener("change", onChange);
	};
}

/** For canvas drawing that cannot follow the CSS theme variables on its own. */
export function useResolvedTheme(): "light" | "dark" {
	return useSyncExternalStore(subscribeTheme, resolvedTheme);
}
