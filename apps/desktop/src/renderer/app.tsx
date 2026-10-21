import { CircleAlert, CircleCheck, Info, Minus, Plus, X } from "./components/icons.tsx";
import { Button, IconButton } from "./components/button.tsx";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { customTokens, fontFaces } from "./appearance.ts";
import { client } from "./client.ts";
import { Home } from "./components/home.tsx";
import { Palette } from "./components/palette.tsx";
import { Rail } from "./components/rail.tsx";
import { Settings, SettingsNav } from "./components/settings.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { ThreadView } from "./components/thread-view.tsx";
import { runAppCommand, TitleBar } from "./components/titlebar.tsx";
import { GO_TO_RECENT, GO_TO_THREAD } from "../shared/keybindings.ts";
import { isEditable, isMac, setBindingOverrides, useBinding, useBindings } from "./keys.ts";
import {
	addProject,
	autoArchive,
	clearUnread,
	dismissToast,
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

/** A view that throws while rendering shows the error instead of blanking the window; another view starts afresh. */
class ViewBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
	state: { error?: Error } = {};

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<CircleAlert size={20} className="text-danger" />
				<p className="text-base text-ink">This view hit an error.</p>
				<p className="max-w-xl text-sm break-words text-secondary">{error.message}</p>
				<Button variant="surface" size="md" onClick={() => this.setState({ error: undefined })}>
					Try again
				</Button>
			</div>
		);
	}
}

const TOAST_MARKS = { success: CircleCheck, error: CircleAlert, info: Info };

/** The newest three toasts, top centre under the title bar (styles.css, .kc-toast). */
function Toasts() {
	const toasts = useStore((s) => s.toasts);
	return (
		<div
			role="status"
			aria-label="Notifications"
			className="pointer-events-none fixed inset-x-0 top-12 z-[60] flex flex-col items-center gap-2 px-2"
		>
			{toasts.slice(-3).map((t) => {
				const Mark = TOAST_MARKS[t.kind];
				return (
					<div key={t.id} data-kind={t.kind} className="kc-toast max-w-[min(560px,100%)]">
						<Mark size={16} className="shrink-0" />
						<span className="min-w-0 [overflow-wrap:anywhere]">{t.text}</span>
						<Button
							size="xs"
							uniform
							pill
							aria-label="Close"
							onClick={() => dismissToast(t.id)}
							className="text-current"
						>
							<X size={16} />
						</Button>
					</div>
				);
			})}
		</div>
	);
}

/**
 * Codex's zoom banner: the level after a zoom, top right beside the caption buttons (8px down, 16px in), with
 * steppers and Reset. It leaves 2s after the last change unless the pointer is on it. Electron zooms the page itself,
 * so the pill undoes the zoom to stay Codex's size.
 */
function ZoomBanner() {
	const [factor, setFactor] = useState(1);
	const [shown, setShown] = useState<"hidden" | "visible" | "exiting">("hidden");
	const timer = useRef<number | undefined>(undefined);
	const hovered = useRef(false);
	const hide = () => {
		window.clearTimeout(timer.current);
		setShown("exiting");
		timer.current = window.setTimeout(() => setShown("hidden"), 150);
	};
	useEffect(() => {
		const off = client.onHostEvent((event) => {
			if (event.event !== "zoom") return;
			setFactor(event.factor);
			setShown("visible");
			window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => {
				timer.current = undefined;
				if (!hovered.current) hide();
			}, 2000);
		});
		return () => {
			off();
			window.clearTimeout(timer.current);
		};
	}, []);
	if (shown === "hidden") return null;
	return (
		<div
			className={`pointer-events-none fixed top-0 z-[56] transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none ${shown === "visible" ? "" : "-translate-y-1 opacity-0"}`}
			style={{ right: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))" }}
		>
			<div
				className="kc-zoom-banner no-drag pointer-events-auto mt-2 me-4 inline-flex h-11 items-center overflow-hidden rounded-[20px] border-[0.5px] border-line bg-surface-secondary px-2 shadow-[0px_8px_16px_-4px_rgba(0,0,0,0.12)]"
				style={{ zoom: 1 / factor }}
				onMouseEnter={() => (hovered.current = true)}
				onMouseLeave={() => {
					hovered.current = false;
					if (shown === "visible" && timer.current === undefined) hide();
				}}
			>
				<span aria-live="polite" className="w-12 text-center text-sm font-semibold text-ink tabular-nums">
					{Math.round(factor * 100)}%
				</span>
				<div className="ms-1 flex items-center">
					<IconButton label="Zoom out" toolbar onClick={() => runAppCommand("zoomOut")}>
						<Minus size={16} />
					</IconButton>
					<IconButton label="Zoom in" toolbar onClick={() => runAppCommand("zoomIn")}>
						<Plus size={16} />
					</IconButton>
				</div>
				<div className="mx-1 h-4 w-px bg-line" />
				<Button color="secondary" toolbar disabled={factor === 1} onClick={() => runAppCommand("resetZoom")}>
					Reset
				</Button>
			</div>
		</div>
	);
}

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
	setBindingOverrides(useStore(selectPreferences).keybindings);
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
			<TitleBar />
			<ServerBanner />
			{/* Codex leaves 8px under the title bar and 4px at the window's right and bottom edges. */}
			<div className="kc-app-body flex min-h-0 flex-1 pt-2 pe-1 pb-1">
				<Rail />
				{/* Sidebar and content sit in one card beside the rail: 12px corners at the left and top right, 4px at
				    the bottom right, the sidebar's own panel and a hairline between it and the content (Codex's). */}
				<div className="kc-app-card flex min-w-0 flex-1 overflow-hidden rounded-tl-[12px] rounded-tr-[12px] rounded-br-[4px] rounded-bl-[12px]">
					{/* Stays mounted so it can slide shut (styles.css, .kc-sidebar-slot); inert while closed. */}
					<div className="kc-sidebar-slot flex shrink-0" data-open={sidebarOpen || undefined} inert={!sidebarOpen}>
						{view.kind === "settings" ? <SettingsNav page={view.page} /> : <Sidebar />}
					</div>
					<main className={`flex min-w-0 flex-1 bg-surface ${sidebarOpen ? "border-l border-line" : ""}`}>
						<ViewBoundary key={view.kind === "thread" ? view.id : view.kind}>
							{view.kind === "thread" ? (
								<ThreadView key={view.id} id={view.id} />
							) : view.kind === "settings" ? (
								<Settings page={view.page} />
							) : (
								<Home key={view.cwd ?? ""} cwd={view.cwd} />
							)}
						</ViewBoundary>
					</main>
				</div>
			</div>
			{paletteOpen ? <Palette /> : null}
			<Toasts />
			<ZoomBanner />
		</div>
	);
}
