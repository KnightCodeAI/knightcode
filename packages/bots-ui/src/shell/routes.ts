// Every screen's URL: parsing a location into a route, formatting a route back, and navigating.
import { useSyncExternalStore } from "react";

/** The tabs of a bot's details pane, and the pages pushed inside it. */
export type PaneView = "details" | "library" | "computer" | "settings" | "memory" | "routines" | "routine-new";

export type SettingsSection =
	"account" | "approvals" | "vault" | "payments" | "channels" | "billing" | "usage" | "computer";

export type Route =
	| { name: "home" }
	| { name: "bot"; botId: string; pane: PaneView | "closed"; routineId?: string }
	| { name: "group"; groupId: string; settings: boolean }
	| { name: "new"; tab: "create" | "templates" | "import" }
	| { name: "connectors"; appId?: string }
	| { name: "skills" }
	| { name: "settings"; section: SettingsSection }
	| { name: "inbox" }
	| { name: "activity" }
	| { name: "pages" }
	| { name: "page"; pageId: string }
	| { name: "not-found"; path: string };

const PANES = new Set<string>(["details", "library", "computer", "settings", "memory", "routines"]);
const SECTIONS = new Set<string>([
	"account",
	"approvals",
	"vault",
	"payments",
	"channels",
	"billing",
	"usage",
	"computer",
]);

/** The route a path and query describe. Unknown paths become `not-found`. */
export function parseRoute(pathname: string, search = ""): Route {
	const query = new URLSearchParams(search);
	const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
	const [first, second, third, fourth] = parts;
	if (!first) return { name: "home" };
	if (first === "bots" && second) {
		if (third === "routines" && fourth === "new") return { name: "bot", botId: second, pane: "routine-new" };
		if (third === "routines" && fourth) return { name: "bot", botId: second, pane: "routines", routineId: fourth };
		if (third && PANES.has(third)) return { name: "bot", botId: second, pane: third as PaneView };
		if (!third) return { name: "bot", botId: second, pane: query.get("pane") === "closed" ? "closed" : "details" };
	}
	if (first === "groups" && second) return { name: "group", groupId: second, settings: third === "settings" };
	if (first === "new") {
		const tab = query.get("tab");
		return { name: "new", tab: tab === "templates" || tab === "import" ? tab : "create" };
	}
	if (first === "connectors") return { name: "connectors", appId: second };
	if (first === "skills") return { name: "skills" };
	if (first === "settings")
		return { name: "settings", section: second && SECTIONS.has(second) ? (second as SettingsSection) : "account" };
	if (first === "inbox") return { name: "inbox" };
	if (first === "activity") return { name: "activity" };
	if (first === "pages") return second ? { name: "page", pageId: second } : { name: "pages" };
	return { name: "not-found", path: pathname };
}

/** The path for a route; `parseRoute(formatRoute(r))` gives `r` back. */
export function formatRoute(route: Route): string {
	const enc = encodeURIComponent;
	switch (route.name) {
		case "home":
			return "/";
		case "bot":
			if (route.pane === "closed") return `/bots/${enc(route.botId)}?pane=closed`;
			if (route.pane === "details") return `/bots/${enc(route.botId)}`;
			if (route.pane === "routine-new") return `/bots/${enc(route.botId)}/routines/new`;
			if (route.pane === "routines" && route.routineId)
				return `/bots/${enc(route.botId)}/routines/${enc(route.routineId)}`;
			return `/bots/${enc(route.botId)}/${route.pane}`;
		case "group":
			return `/groups/${enc(route.groupId)}${route.settings ? "/settings" : ""}`;
		case "new":
			return route.tab === "create" ? "/new" : `/new?tab=${route.tab}`;
		case "connectors":
			return route.appId ? `/connectors/${enc(route.appId)}` : "/connectors";
		case "skills":
			return "/skills";
		case "settings":
			return `/settings/${route.section}`;
		case "inbox":
			return "/inbox";
		case "activity":
			return "/activity";
		case "pages":
			return "/pages";
		case "page":
			return `/pages/${enc(route.pageId)}`;
		case "not-found":
			return route.path;
	}
}

// Query parameters that describe the session rather than the screen (the seed, test switches) survive navigation.
const STICKY = ["seed"];

/** Goes to `route` (or a path), keeping sticky query parameters. */
export function navigate(to: Route | string, options: { replace?: boolean } = {}): void {
	const target = new URL(typeof to === "string" ? to : formatRoute(to), location.origin);
	const current = new URLSearchParams(location.search);
	for (const key of STICKY) {
		const value = current.get(key);
		if (value !== null && !target.searchParams.has(key)) target.searchParams.set(key, value);
	}
	const href = `${target.pathname}${target.search}`;
	if (options.replace) history.replaceState(null, "", href);
	else history.pushState(null, "", href);
	window.dispatchEvent(new Event("kb:navigate"));
}

function subscribe(onChange: () => void): () => void {
	window.addEventListener("popstate", onChange);
	window.addEventListener("kb:navigate", onChange);
	return () => {
		window.removeEventListener("popstate", onChange);
		window.removeEventListener("kb:navigate", onChange);
	};
}

const snapshot = () => `${location.pathname}${location.search}`;

/** The current route; re-renders on navigation. */
export function useRoute(): Route {
	const href = useSyncExternalStore(subscribe, snapshot, snapshot);
	const url = new URL(href, "http://local");
	return parseRoute(url.pathname, url.search);
}

/** A query parameter of the current location; re-renders on navigation. */
export function useQueryParam(name: string): string | null {
	const href = useSyncExternalStore(subscribe, snapshot, snapshot);
	return new URL(href, "http://local").searchParams.get(name);
}
