// Search across bots, groups and conversations: names match locally at once, messages and pages come from the API.
import type { SearchHit } from "@knightcode/bots-protocol";
import { useEffect, useMemo, useState } from "react";
import { useBots, useStore } from "../state/store.ts";
import type { Route } from "./routes.ts";

export interface Hit {
	key: string;
	title: string;
	snippet?: string;
	kind: SearchHit["kind"];
	route: Route;
}

/** Hits for `query`: bots and groups first (instant), then messages, pages and skills. */
export function useSearch(query: string): Hit[] {
	const store = useStore();
	const { data } = useBots();
	const [remote, setRemote] = useState<SearchHit[]>([]);
	const needle = query.trim().toLowerCase();
	useEffect(() => {
		if (needle.length < 2) return setRemote([]);
		let live = true;
		const timer = setTimeout(() => {
			void store.api.search({ q: needle }).then((result) => live && setRemote(result.hits));
		}, 150);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [store, needle]);
	return useMemo(() => {
		const bots = (data?.bots ?? []).filter((b) => !b.archived && (!needle || b.name.toLowerCase().includes(needle)));
		const groups = (data?.groups ?? []).filter((g) => !needle || g.name.toLowerCase().includes(needle));
		const local: Hit[] = [
			...bots.map((b): Hit => ({
				key: `bot:${b.id}`,
				title: b.name,
				snippet: b.purpose,
				kind: "bot",
				route: { name: "bot", botId: b.id, pane: "details" },
			})),
			...groups.map((g): Hit => ({
				key: `group:${g.id}`,
				title: g.name,
				kind: "group",
				route: { name: "group", groupId: g.id, settings: false },
			})),
		];
		const seen = new Set(local.map((h) => h.key));
		const fromServer = remote
			.map((hit) => toHit(hit))
			.filter((hit): hit is Hit => hit !== undefined && !seen.has(hit.key));
		return [...local, ...fromServer];
	}, [data, needle, remote]);
}

function toHit(hit: SearchHit): Hit | undefined {
	switch (hit.kind) {
		case "bot":
			return {
				key: `bot:${hit.id}`,
				title: hit.title,
				snippet: hit.snippet,
				kind: "bot",
				route: { name: "bot", botId: hit.id, pane: "details" },
			};
		case "group":
			return {
				key: `group:${hit.id}`,
				title: hit.title,
				kind: "group",
				route: { name: "group", groupId: hit.id, settings: false },
			};
		case "message":
			return hit.botId
				? {
						key: `message:${hit.id}`,
						title: hit.title,
						snippet: hit.snippet,
						kind: "message",
						route: { name: "bot", botId: hit.botId, pane: "details" },
					}
				: undefined;
		case "page":
			return { key: `page:${hit.id}`, title: hit.title, kind: "page", route: { name: "page", pageId: hit.id } };
		case "skill":
			return {
				key: `skill:${hit.id}`,
				title: hit.title,
				snippet: hit.snippet,
				kind: "skill",
				route: { name: "skills" },
			};
	}
}
