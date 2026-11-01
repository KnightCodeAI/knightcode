// The KnightCode Bots app: one store and socket, the three-column shell, and the screen the URL names.
import { type ApiClient, type CatchUp as CatchUpData, type WebSocketLike } from "@knightcode/bots-protocol";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotSettings } from "./bot/BotSettings.tsx";
import { CreateBot } from "./bot/CreateBot.tsx";
import { ChatView } from "./chat/ChatView.tsx";
import { Catalog } from "./connectors/Catalog.tsx";
import { GroupChat } from "./groups/GroupChat.tsx";
import { GroupSettings } from "./groups/GroupSettings.tsx";
import { awayFor, CatchUp, isAway, markActive } from "./inbox/CatchUp.tsx";
import { Inbox } from "./inbox/Inbox.tsx";
import { Checklist, type OnboardingItem, onboardingSkipped, openItems } from "./onboarding/Checklist.tsx";
import { PagesLibrary } from "./pages/Library.tsx";
import { PageView } from "./pages/PageView.tsx";
import { SettingsDialog } from "./settings/SettingsDialog.tsx";
import { SkillsLibrary } from "./skills/Library.tsx";
import { SandboxOriginContext } from "./chat/McpAppFrame.tsx";
import { ToastProvider } from "./primitives/Toast.tsx";
import { applyThemePreference } from "./theme.ts";
import { CommandK, useCommandKShortcut } from "./shell/CommandK.tsx";
import { InfoPane } from "./shell/InfoPane.tsx";
import { PlatformContext } from "./platform.ts";
import { MobileNav, useIsPhone } from "./shell/MobileNav.tsx";
import { formatRoute, navigate, type Route, routeInMemory, useQueryParam, useRoute } from "./shell/routes.ts";
import { Sidebar } from "./shell/Sidebar.tsx";
import { ThreadSocket } from "./state/socket.ts";
import { BotsStore, StoreContext, useBots, useResource } from "./state/store.ts";

export interface BotsAppProps {
	api: ApiClient;
	connect: () => WebSocketLike;
	platform: "web" | "desktop";
	/** The separate origin MCP App panels load from; panels are not shown without one. */
	sandboxOrigin?: string;
	/** Shown at the start of the sidebar's header: the desktop app's product switcher. */
	sidebarHeader?: ReactNode;
}

/** The whole UI. The host provides the API, a socket factory and which platform it runs on. */
export function BotsApp({ api, connect, platform, sandboxOrigin, sidebarHeader }: BotsAppProps) {
	// Before the first render reads a route.
	useState(() => platform === "desktop" && routeInMemory());
	const store = useMemo(
		() =>
			new BotsStore(api, new ThreadSocket(connect, async () => (await api.issueTicket({ scope: "socket" })).ticket)),
		[api, connect],
	);
	useEffect(() => () => store.socket.close(), [store]);
	// The desktop app sets the theme on the page itself.
	useEffect(() => {
		if (platform === "web") applyThemePreference();
	}, [platform]);
	return (
		<PlatformContext.Provider value={platform}>
			<StoreContext.Provider value={store}>
				<SandboxOriginContext.Provider value={sandboxOrigin}>
					<ToastProvider>
						<div className="kb-app" data-platform={platform} style={{ height: "100%" }}>
							<Shell sidebarHeader={sidebarHeader} />
						</div>
					</ToastProvider>
				</SandboxOriginContext.Provider>
			</StoreContext.Provider>
		</PlatformContext.Provider>
	);
}

/** Dialog routes keep the last chat underneath them. */
function Shell({ sidebarHeader }: { sidebarHeader?: ReactNode }) {
	const route = useRoute();
	const { data } = useBots();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const openPalette = useCallback(() => setPaletteOpen(true), []);
	useCommandKShortcut(openPalette);
	const lastBot = useRef<string | undefined>(undefined);
	if (route.name === "bot") lastBot.current = route.botId;

	const firstBot = data?.bots.find((b) => !b.archived);
	const catchUp = useCatchUp(route.name === "home");
	const onboarding = useOnboarding(route.name === "home" && catchUp === null);
	const toChat = useCallback(
		(replace = false) =>
			firstBot && navigate({ name: "bot", botId: lastBot.current ?? firstBot.id, pane: "details" }, { replace }),
		[firstBot],
	);
	useEffect(() => {
		if (route.name === "home" && catchUp === null && onboarding === null) toChat(true);
	}, [route.name, catchUp, onboarding, toChat]);
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

	const view = mainView(route, catchUp, onboarding);
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
	// On a phone the chat comes first: the details pane opens only when asked for (?pane=details or a tab).
	const phone = useIsPhone();
	const paneParam = useQueryParam("pane");
	const shownPane =
		phone && !(route.name === "bot" && (route.pane !== "details" || paneParam === "details")) ? "closed" : pane;
	const [navOpen, setNavOpen] = useState(false);
	const path = formatRoute(route);
	useEffect(() => setNavOpen(false), [path]);
	const edit = useQueryParam("edit");
	const avatar = useQueryParam("avatar");
	const editing = edit !== null || avatar !== null;
	const backToChat = () =>
		botId ? navigate({ name: "bot", botId, pane: route.name === "bot" ? route.pane : "details" }) : navigate("/");

	return (
		<>
			<div className="kb-shell" data-ref="shell" data-nav-open={phone && navOpen ? "" : undefined}>
				<Sidebar route={route} onSearch={openPalette} header={sidebarHeader} />
				<main className="kb-chat" data-ref="chat">
					{phone && <MobileNav open={navOpen} onOpenChange={setNavOpen} />}
					{route.name === "group" ? (
						group ? (
							<GroupChat group={group} />
						) : route.groupId === "new" ? null : (
							<MainView route={route} loading={!data} />
						)
					) : view ? (
						<MainContent view={view} catchUp={catchUp} onboarding={onboarding} onDone={() => toChat()} />
					) : bot && route.name !== "home" ? (
						<ChatView bot={bot} paneOpen={shownPane !== "closed"} phone={phone} />
					) : (
						<MainView route={route} loading={!data} />
					)}
				</main>
				{bot && <InfoPane bot={bot} view={shownPane} routineId={route.name === "bot" ? route.routineId : undefined} />}
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

type MainViewKind =
	| { kind: "inbox" }
	| { kind: "pages" }
	| { kind: "page"; pageId: string }
	| { kind: "catch-up" }
	| { kind: "onboarding" };

/** The views that take the chat column: the inbox, pages, and the catch-up on return. */
function mainView(
	route: Route,
	catchUp: CatchUpData | null | undefined,
	onboarding: OnboardingItem[] | null | undefined,
): MainViewKind | undefined {
	if (route.name === "inbox") return { kind: "inbox" };
	if (route.name === "pages") return { kind: "pages" };
	if (route.name === "page") return { kind: "page", pageId: route.pageId };
	if (route.name === "home" && catchUp) return { kind: "catch-up" };
	if (route.name === "home" && onboarding) return { kind: "onboarding" };
	return undefined;
}

function MainContent({
	view,
	catchUp,
	onboarding,
	onDone,
}: {
	view: MainViewKind;
	catchUp: CatchUpData | null | undefined;
	onboarding: OnboardingItem[] | null | undefined;
	onDone: () => void;
}) {
	if (view.kind === "inbox") return <Inbox />;
	if (view.kind === "pages") return <PagesLibrary />;
	if (view.kind === "page") return <PageView pageId={view.pageId} />;
	if (view.kind === "onboarding") return onboarding ? <Checklist items={onboarding} onSkip={onDone} /> : null;
	return catchUp ? <CatchUp catchUp={catchUp} onDone={onDone} /> : null;
}

/** On the home screen, the onboarding items still to do (unless skipped; ?onboarding=1 shows them anyway); null when none. */
function useOnboarding(home: boolean): OnboardingItem[] | null | undefined {
	const forced = useQueryParam("onboarding") !== null;
	const [skipped] = useState(onboardingSkipped);
	const wanted = home && (forced || !skipped);
	const { data } = useResource(wanted ? "onboarding" : null, (api) => api.getOnboarding({}));
	if (!home) return undefined;
	if (!wanted) return null;
	if (data === undefined) return undefined;
	const open = openItems(data.items);
	return open.length > 0 ? open : null;
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
