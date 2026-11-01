// The KnightCode Bots app: one store and socket, the three-column shell, and the screen the URL names.
import { type ApiClient, type CatchUp as CatchUpData, type WebSocketLike } from "@knightcode/bots-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotSettings } from "./bot/BotSettings.tsx";
import { CreateBot } from "./bot/CreateBot.tsx";
import { ChatView } from "./chat/ChatView.tsx";
import { Catalog } from "./connectors/Catalog.tsx";
import { GroupChat } from "./groups/GroupChat.tsx";
import { GroupSettings } from "./groups/GroupSettings.tsx";
import { awayFor, CatchUp, isAway, markActive } from "./inbox/CatchUp.tsx";
import { Inbox } from "./inbox/Inbox.tsx";
import { PagesLibrary } from "./pages/Library.tsx";
import { PageView } from "./pages/PageView.tsx";
import { SettingsDialog } from "./settings/SettingsDialog.tsx";
import { SkillsLibrary } from "./skills/Library.tsx";
import { SandboxOriginContext } from "./chat/McpAppFrame.tsx";
import { ToastProvider } from "./primitives/Toast.tsx";
import { CommandK, useCommandKShortcut } from "./shell/CommandK.tsx";
import { InfoPane } from "./shell/InfoPane.tsx";
import { navigate, type Route, useQueryParam, useRoute } from "./shell/routes.ts";
import { Sidebar } from "./shell/Sidebar.tsx";
import { ThreadSocket } from "./state/socket.ts";
import { BotsStore, StoreContext, useBots, useResource } from "./state/store.ts";

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
	const catchUp = useCatchUp(route.name === "home");
	useEffect(() => {
		if (route.name === "home" && firstBot && catchUp === null)
			navigate({ name: "bot", botId: lastBot.current ?? firstBot.id, pane: "details" }, { replace: true });
	}, [route.name, firstBot, catchUp]);
	useEffect(() => {
		const active = () => markActive();
		active();
		window.addEventListener("pointerdown", active);
		window.addEventListener("keydown", active);
		return () => {
			window.removeEventListener("pointerdown", active);
			window.removeEventListener("keydown", active);
		};
	}, []);

	const view = mainView(route, catchUp);
	// Dialogs and main views keep a bot's details pane beside them, as the pane is open by default.
	const botId =
		route.name === "bot" ? route.botId : isOverlay(route) || view ? (lastBot.current ?? firstBot?.id) : undefined;
	const bot = data?.bots.find((b) => b.id === botId);
	const group = route.name === "group" ? data?.groups.find((g) => g.id === route.groupId) : undefined;
	const pane =
		route.name === "bot"
			? route.pane
			: route.name === "page" || route.name === "pages"
				? "library"
				: bot
					? "details"
					: "closed";
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
					{route.name === "group" ? (
						group ? (
							<GroupChat group={group} />
						) : route.groupId === "new" ? null : (
							<MainView route={route} loading={!data} />
						)
					) : view ? (
						<MainContent
							view={view}
							catchUp={catchUp}
							onCatchUpDone={() =>
								firstBot && navigate({ name: "bot", botId: lastBot.current ?? firstBot.id, pane: "details" })
							}
						/>
					) : bot && route.name !== "home" ? (
						<ChatView bot={bot} paneOpen={pane !== "closed"} />
					) : (
						<MainView route={route} loading={!data} />
					)}
				</main>
				{bot && <InfoPane bot={bot} view={pane} routineId={route.name === "bot" ? route.routineId : undefined} />}
			</div>
			<CommandK open={paletteOpen} onOpenChange={setPaletteOpen} />
			{route.name === "new" && <CreateBot tab={route.tab} onClose={backToChat} />}
			{route.name === "connectors" && <Catalog appId={route.appId} onClose={backToChat} />}
			{route.name === "skills" && <SkillsLibrary onClose={backToChat} />}
			{route.name === "settings" && <SettingsDialog view={route.section} onClose={backToChat} />}
			{route.name === "activity" && <SettingsDialog view="activity" onClose={backToChat} />}
			{route.name === "group" && route.settings && (group || route.groupId === "new") && (
				<GroupSettings
					group={group}
					onClose={() => (group ? navigate({ name: "group", groupId: group.id, settings: false }) : backToChat())}
				/>
			)}
			{route.name === "bot" && route.pane === "settings" && editing && bot && (
				<BotSettings bot={bot} onClose={() => navigate({ name: "bot", botId: bot.id, pane: "settings" })} />
			)}
		</>
	);
}

type MainViewKind = { kind: "inbox" } | { kind: "pages" } | { kind: "page"; pageId: string } | { kind: "catch-up" };

/** The views that take the chat column: the inbox, pages, and the catch-up on return. */
function mainView(route: Route, catchUp: CatchUpData | null | undefined): MainViewKind | undefined {
	if (route.name === "inbox") return { kind: "inbox" };
	if (route.name === "pages") return { kind: "pages" };
	if (route.name === "page") return { kind: "page", pageId: route.pageId };
	if (route.name === "home" && catchUp) return { kind: "catch-up" };
	return undefined;
}

function MainContent({
	view,
	catchUp,
	onCatchUpDone,
}: {
	view: MainViewKind;
	catchUp: CatchUpData | null | undefined;
	onCatchUpDone: () => void;
}) {
	if (view.kind === "inbox") return <Inbox />;
	if (view.kind === "pages") return <PagesLibrary />;
	if (view.kind === "page") return <PageView pageId={view.pageId} />;
	return catchUp ? <CatchUp catchUp={catchUp} onDone={onCatchUpDone} /> : null;
}

/** On the home screen after a long absence, the catch-up if something happened; null when there is none to show. */
function useCatchUp(home: boolean): CatchUpData | null | undefined {
	const away = useQueryParam("away");
	const [gap] = useState(() => awayFor(away));
	const { data } = useResource(home && isAway(away ? awayFor(away) : gap) ? "catch-up" : null, (api) =>
		api.getCatchUp({}),
	);
	if (!home) return undefined;
	if (!isAway(away ? awayFor(away) : gap)) return null;
	return data === undefined ? undefined : data.catchUp;
}

function isOverlay(route: Route): boolean {
	return (
		route.name === "new" ||
		route.name === "connectors" ||
		route.name === "skills" ||
		route.name === "settings" ||
		route.name === "activity"
	);
}

function MainView({ route, loading }: { route: Route; loading: boolean }) {
	if (loading) return null;
	if (route.name === "not-found" || route.name === "bot" || route.name === "group")
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
