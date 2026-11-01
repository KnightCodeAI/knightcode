// The resolved colour theme: the root's data-theme when set, otherwise the system preference.
import { useSyncExternalStore } from "react";
import type { Theme } from "./tokens/tokens.ts";

const LIGHT = "(prefers-color-scheme: light)";

/** The theme currently on screen; re-renders when the system preference or the root's data-theme changes. */
export function useResolvedTheme(): Theme {
	return useSyncExternalStore(subscribe, currentTheme, () => "dark");
}

/** The theme on screen right now, outside React. */
export function currentTheme(): Theme {
	const forced = document.documentElement.dataset.theme;
	if (forced === "dark" || forced === "light") return forced;
	return window.matchMedia(LIGHT).matches ? "light" : "dark";
}

function subscribe(onChange: () => void): () => void {
	const media = window.matchMedia(LIGHT);
	media.addEventListener("change", onChange);
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
	return () => {
		media.removeEventListener("change", onChange);
		observer.disconnect();
	};
}

/** What the user chose: follow the system, or always light or dark. Kept in this browser. */
export type ThemePreference = "system" | "light" | "dark";

const THEME_KEY = "kb.theme";

/** The stored preference; "system" when none. */
export function getThemePreference(): ThemePreference {
	try {
		const value = localStorage.getItem(THEME_KEY);
		return value === "light" || value === "dark" ? value : "system";
	} catch {
		return "system";
	}
}

/** Stores the preference and applies it to the root. */
export function setThemePreference(preference: ThemePreference): void {
	try {
		if (preference === "system") localStorage.removeItem(THEME_KEY);
		else localStorage.setItem(THEME_KEY, preference);
	} catch {
		// Storage may be unavailable; the choice still applies until reload.
	}
	applyThemePreference(preference);
}

/** Puts the preference on the root's data-theme (none for "system"). */
export function applyThemePreference(preference = getThemePreference()): void {
	if (preference === "system") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = preference;
}
