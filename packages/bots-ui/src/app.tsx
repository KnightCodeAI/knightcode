// The KnightCode Bots app: one store and socket, the three-column shell, and the screen the URL names.
import { type ApiClient, type WebSocketLike } from "@knightcode/bots-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "./chat/ChatView.tsx";
import { ToastProvider } from "./primitives/Toast.tsx";
import { CommandK, useCommandKShortcut } from "./shell/CommandK.tsx";
import { InfoPane } from "./shell/InfoPane.tsx";
import { navigate, type Route, useRoute } from "./shell/routes.ts";
import { Sidebar } from "./shell/Sidebar.tsx";
import { ThreadSocket } from "./state/socket.ts";
import { BotsStore, StoreContext, useBots } from "./state/store.ts";

export interface BotsAppProps {
	api: ApiClient;
	connect: () => WebSocketLike;
	platform: "web" | "desktop";
}

/** The whole UI. The host provides the API, a socket factory and which platform it runs on. */
export function BotsApp({ api, connect, platform }: BotsAppProps) {
	const store = useMemo(
		() =>
			new BotsStore(api, new ThreadSocket(connect, async () => (await api.issueTicket({ scope: "socket" })).ticket)),
		[api, connect],
	);
	useEffect(() => () => store.socket.close(), [store]);
	return (
		<StoreContext.Provider value={store}>
			<ToastProvider>
				<div className="kb-app" data-platform={platform} style={{ height: "100%" }}>
					<Shell />
				</div>
			</ToastProvider>
		</StoreContext.Provider>
	);
}

/** Dialog routes keep the last chat underneath them. */
function Shell() {
	const route = useRoute();
	const { data } = useBots();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const openPalette = useCallback(() => setPaletteOpen(true), []);
	useCommandKShortcut(openPalette);
	const lastBot = useRef<string | undefined>(undefined);
	if (route.name === "bot") lastBot.current = route.botId;

	const firstBot = data?.bots.find((b) => !b.archived);
	useEffect(() => {
		if (route.name === "home" && firstBot)
			navigate({ name: "bot", botId: lastBot.current ?? firstBot.id, pane: "details" }, { replace: true });
	}, [route.name, firstBot]);

	const botId = route.name === "bot" ? route.botId : isOverlay(route) ? (lastBot.current ?? firstBot?.id) : undefined;
	const bot = data?.bots.find((b) => b.id === botId);
	const pane = route.name === "bot" ? route.pane : "closed";

	return (
		<>
			<div className="kb-shell" data-ref="shell">
				<Sidebar route={route} onSearch={openPalette} />
				<main className="kb-chat" data-ref="chat">
					{bot ? <ChatView bot={bot} paneOpen={pane !== "closed"} /> : <MainView route={route} loading={!data} />}
				</main>
				{bot && <InfoPane bot={bot} view={pane} />}
			</div>
			<CommandK open={paletteOpen} onOpenChange={setPaletteOpen} />
		</>
	);
}

function isOverlay(route: Route): boolean {
	return route.name === "new" || route.name === "connectors" || route.name === "skills" || route.name === "settings";
}

function MainView({ route, loading }: { route: Route; loading: boolean }) {
	if (loading) return null;
	if (route.name === "not-found" || route.name === "bot")
		return (
			<div className="kb-view">
				<div className="kb-view__inner">
					<h1 className="kb-view__title">Nothing here</h1>
					<p style={{ color: "var(--kb-color-text-secondary)" }}>This page does not exist, or the bot was deleted.</p>
				</div>
			</div>
		);
	return null;
}
