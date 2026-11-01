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
