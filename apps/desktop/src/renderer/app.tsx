import { CircleAlert } from "./components/icons.tsx";
import { useEffect } from "react";
import { customTokens, fontFaces } from "./appearance.ts";
import { client } from "./client.ts";
import { Palette } from "./components/palette.tsx";
import { controllers } from "./extensions/controllers.ts";
import { LayoutSurface, StructuralSurface } from "./extensions/structural.tsx";
import { GO_TO_RECENT, GO_TO_THREAD } from "../shared/keybindings.ts";
import { isEditable, isMac, runBinding, setBindingOverrides, useBinding, useBindings } from "./keys.ts";
import { FeedbackSurface } from "./extensions/host.tsx";
import {
	addProject,
	autoArchive,
	clearUnread,
	goBack,
	navigate,
	selectPreferences,
	setResolvedTheme,
	setPaletteOpen,
	setSidebarOpen,
	openNextInSidebar,
	openNextNeedingAttention,
	openRecent,
	openSlot,
	showNew,
	useStore,
} from "./store.ts";

function ServerBanner() {
	const server = useStore((s) => s.server);
	if (server.state === "ready") return null;
	if (server.state === "failed")
		return (
			<div className="flex items-center gap-2 border-b border-danger/30 bg-del-bg px-4 py-2 text-danger">
				<CircleAlert size={14} /> {server.message ?? "KnightCode stopped."}
				<button type="button" className="underline" onClick={() => void client.host("host/server/restart", {})}>
					Restart
				</button>
				<button type="button" className="underline" onClick={() => navigate({ kind: "settings", page: "about" })}>
					Show logs
				</button>
			</div>
		);
	return (
		<div className="kc-pulse border-b border-line bg-elevated px-4 py-1.5 text-center text-[13px] text-secondary">
			{server.state === "starting" ? "Starting KnightCode…" : "Reconnecting to KnightCode…"}
		</div>
	);
}

const runAppCommand = (command: Parameters<typeof controllers.experimental_windowCommand>[0]) =>
	void controllers.experimental_windowCommand(command);

/**
 * Resolve the theme preference onto <html> and the native caption buttons, and lay the theme's customization
 * (Settings › Appearance) over its tokens: colours and fonts (appearance.ts), the chosen font faces, the sidebar's
 * material, and the window-wide sizes, diff markers and pointer cursors.
 */
function useTheme(): void {
	const prefs = useStore(selectPreferences);
	const { theme, appearance } = prefs;
	const resolved = useStore((s) => s.resolvedTheme);
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = theme === "dark" || (theme === "system" && media.matches);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
			setResolvedTheme(dark ? "dark" : "light");
		};
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [theme]);
	const custom = appearance?.[resolved];
	const translucent = custom?.translucentSidebar === true;
	useEffect(() => {
		// Main says whether the material took (Windows 11 22H2+, macOS); only then is the sidebar see-through.
		void client
			.host("host/window/setTheme", { dark: resolved === "dark", translucent })
			.then((r) => {
				if (r.translucent) document.documentElement.dataset.translucent = "";
				else delete document.documentElement.dataset.translucent;
			})
			.catch(() => {});
	}, [resolved, translucent]);
	useEffect(() => {
		const tokens = customTokens(resolved, custom);
		const root = document.documentElement.style;
		for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
		const faces = document.createElement("style");
		faces.textContent = fontFaces(custom);
		document.head.append(faces);
		return () => {
			for (const name of Object.keys(tokens)) root.removeProperty(name);
			faces.remove();
		};
	}, [resolved, custom]);
	const { uiFontSize, codeFontSize, pointerCursors } = prefs;
	useEffect(() => {
		const root = document.documentElement;
		if (uiFontSize) root.style.setProperty("--kc-ui-scale", String(uiFontSize / 14));
		if (codeFontSize) root.style.setProperty("--kc-size-code", `${codeFontSize}px`);
		if (pointerCursors) root.dataset.pointerCursors = "";
		return () => {
			root.style.removeProperty("--kc-ui-scale");
			root.style.removeProperty("--kc-size-code");
			delete root.dataset.pointerCursors;
		};
	}, [uiFontSize, codeFontSize, pointerCursors]);
}

/** Settings › General's auto-archive: check when the list or the limit changes, and hourly. */
function useAutoArchive(): void {
	const days = useStore(selectPreferences).autoArchiveDays;
	const count = useStore((s) => s.threads.length);
	useEffect(() => {
		void autoArchive().catch(() => {});
		if (!days) return;
		const timer = setInterval(() => void autoArchive().catch(() => {}), 3_600_000);
		return () => clearInterval(timer);
	}, [days, count]);
}

/** Option+Arrow moves the caret by word in a macOS text field, so leave it to the field there. */
function navigateHistory(event: KeyboardEvent, delta: -1 | 1): false | undefined {
	if (isMac() && isEditable(event.target)) return false;
	goBack(delta);
}

/** The mouse's back and forward buttons walk the view history, as Codex binds "Mouse Back" and "Mouse Forward". */
function useMouseHistory(): void {
	useEffect(() => {
		const onUp = (event: MouseEvent) => {
			if (event.button !== 3 && event.button !== 4) return;
			event.preventDefault();
			goBack(event.button === 3 ? -1 : 1);
		};
		window.addEventListener("mouseup", onUp);
		return () => window.removeEventListener("mouseup", onUp);
	}, []);
}

export function App() {
	const view = useStore((s) => s.view);
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const paletteOpen = useStore((s) => s.paletteOpen);
	// Before anything below reads a binding (keys.ts): the user's rebound shortcuts.
	const keybindings = useStore(selectPreferences).keybindings;
	setBindingOverrides(keybindings);
	// Main matches them too, for keys pressed in a preview's page, and hands those back as key events.
	useEffect(() => {
		void client.host("host/keys/set", { overrides: keybindings ?? {} }).catch(() => {});
	}, [keybindings]);
	useEffect(() => client.onHostEvent((event) => event.event === "key" && runBinding(event.binding)), []);
	useTheme();
	useMouseHistory();
	useBinding("desktop.thread.new", () => showNew());
	useBinding("desktop.project.open", () => void addProject());
	useBinding("desktop.sidebar.toggle", () => setSidebarOpen(!sidebarOpen));
	useBinding("desktop.palette", () => setPaletteOpen(!paletteOpen));
	useBinding("desktop.settings", () => navigate({ kind: "settings", page: "general" }));
	useBinding("desktop.shortcuts", () => navigate({ kind: "settings", page: "shortcuts" }));
	useBinding("desktop.nav.back", (event) => navigateHistory(event, -1));
	useBinding("desktop.nav.forward", (event) => navigateHistory(event, 1));
	useBinding("desktop.view.zoomIn", () => runAppCommand("zoomIn"));
	useBinding("desktop.view.zoomOut", () => runAppCommand("zoomOut"));
	useBinding("desktop.view.zoomReset", () => runAppCommand("resetZoom"));
	useBinding("desktop.view.fullScreen", () => runAppCommand("toggleFullScreen"));
	useBinding("desktop.app.quit", () => runAppCommand("quit"));
	useBinding("desktop.window.close", () => runAppCommand("close"));
	useBinding("desktop.thread.clearUnread", () => clearUnread());
	useAutoArchive();
	// Codex's thread navigation: sidebar slots, recent slots, the next or previous sidebar item, the next waiting.
	useBindings([
		...GO_TO_THREAD.map((binding, slot) => ({ binding, run: () => openSlot(slot) })),
		...GO_TO_RECENT.map((binding, slot) => ({ binding, run: () => openRecent(slot) })),
		{ binding: "desktop.thread.next", run: () => openNextInSidebar(1) },
		{ binding: "desktop.thread.previous", run: () => openNextInSidebar(-1) },
		{ binding: "desktop.thread.nextAttention", run: () => openNextNeedingAttention() },
	]);
	return (
		<div className="kc-app flex h-full flex-col bg-shell">
			<StructuralSurface surface="titleBar" />
			<ServerBanner />
			<LayoutSurface />
			{paletteOpen ? <Palette /> : null}
			<FeedbackSurface />
		</div>
	);
}
