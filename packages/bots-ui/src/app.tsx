// The KnightCode Bots app: one store and socket, the three-column shell, and the screen the URL names.
import { type ApiClient, type WebSocketLike } from "@knightcode/bots-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotSettings } from "./bot/BotSettings.tsx";
import { CreateBot } from "./bot/CreateBot.tsx";
import { ChatView } from "./chat/ChatView.tsx";
import { Catalog } from "./connectors/Catalog.tsx";
import { SkillsLibrary } from "./skills/Library.tsx";
import { SandboxOriginContext } from "./chat/McpAppFrame.tsx";
import { ToastProvider } from "./primitives/Toast.tsx";
import { CommandK, useCommandKShortcut } from "./shell/CommandK.tsx";
import { InfoPane } from "./shell/InfoPane.tsx";
import { navigate, type Route, useQueryParam, useRoute } from "./shell/routes.ts";
import { Sidebar } from "./shell/Sidebar.tsx";
import { ThreadSocket } from "./state/socket.ts";
import { BotsStore, StoreContext, useBots } from "./state/store.ts";

export interface BotsAppProps {
	api: ApiClient;
	connect: () => WebSocketLike;
	platform: "web" | "desktop";
	/** The separate origin MCP App panels load from; panels are not shown without one. */
	sandboxOrigin?: string;
}

/** The whole UI. The host provides the API, a socket factory and which platform it runs on. */
export function BotsApp({ api, connect, platform, sandboxOrigin }: BotsAppProps) {
	const store = useMemo(
		() =>
			new BotsStore(api, new ThreadSocket(connect, async () => (await api.issueTicket({ scope: "socket" })).ticket)),
		[api, connect],
	);
	useEffect(() => () => store.socket.close(), [store]);
	return (
		<StoreContext.Provider value={store}>
			<SandboxOriginContext.Provider value={sandboxOrigin}>
				<ToastProvider>
					<div className="kb-app" data-platform={platform} style={{ height: "100%" }}>
						<Shell />
					</div>
				</ToastProvider>
			</SandboxOriginContext.Provider>
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
	// Dialogs open over the chat with its details pane, as the pane is open by default.
	const pane = route.name === "bot" ? route.pane : isOverlay(route) ? "details" : "closed";
	const edit = useQueryParam("edit");
	const avatar = useQueryParam("avatar");
	const editing = edit !== null || avatar !== null;
	const backToChat = () =>
		botId ? navigate({ name: "bot", botId, pane: route.name === "bot" ? route.pane : "details" }) : navigate("/");

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
			{route.name === "new" && <CreateBot tab={route.tab} onClose={backToChat} />}
			{route.name === "connectors" && <Catalog appId={route.appId} onClose={backToChat} />}
			{route.name === "skills" && <SkillsLibrary onClose={backToChat} />}
			{route.name === "bot" && route.pane === "settings" && editing && bot && (
				<BotSettings bot={bot} onClose={() => navigate({ name: "bot", botId: bot.id, pane: "settings" })} />
			)}
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
