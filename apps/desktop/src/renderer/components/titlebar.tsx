/**
 * The title bar (desktop-shell.md section 9.1), as Codex's (measured 2026-10-19): a 36px bar with Back, Forward and
 * the sidebar toggle (28px, 6px apart, 6px in), then File, Edit, View and Help; the rest of the bar drags the window.
 * Windows draws its caption buttons over the right end (titleBarOverlay); macOS keeps its traffic lights at the left.
 * The menus follow Codex's names and order; the items only KnightCode has (palette, reload, developer tools,
 * archived threads) sit where they fit.
 */

import { ArrowLeft, ArrowRight, Download, PanelLeft } from "./icons.tsx";
import { client } from "../client.ts";
import { bindingLabel, isMac } from "../keys.ts";
import { type AppCommandName, WINDOW_CHROME } from "../../shared/host-protocol.ts";
import {
	addProject,
	checkForUpdates,
	goBack,
	installUpdate,
	openUpdatePage,
	navigate,
	setFinding,
	setPaletteOpen,
	setSidebarOpen,
	showNew,
	useStore,
} from "../store.ts";
import { IconButton } from "./button.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./menu.tsx";

export const runAppCommand = (command: AppCommandName) => void client.host("host/app/command", { command });

type AppMenuItem = { label: string; hint?: string; disabled?: boolean; run: () => void } | "-";

/** One of the title bar's application menus, drawn as Codex draws its own (styles.css, .kc-app-menu). */
function AppMenu({ label, items }: { label: string; items: AppMenuItem[] }) {
	return (
		<Menu>
			<MenuTrigger>
				<button
					type="button"
					className="no-drag rounded-md border border-transparent px-2.5 py-1 text-base leading-none text-tertiary hover:bg-soft-alt data-[state=open]:bg-soft-alt"
				>
					{label}
				</button>
			</MenuTrigger>
			<MenuContent variant="app">
				{items.map((item, i) =>
					item === "-" ? (
						<MenuSeparator key={i} />
					) : (
						<MenuItem key={item.label} hint={item.hint} disabled={item.disabled} onSelect={item.run}>
							{item.label}
						</MenuItem>
					),
				)}
			</MenuContent>
		</Menu>
	);
}

/** The menus' items. Editing commands are the system's, not desktop bindings, so their hints are spelled out. */
function appMenus(sidebarOpen: boolean, inThread: boolean): { label: string; items: AppMenuItem[] }[] {
	const mod = isMac() ? "⌘" : "Ctrl+";
	return [
		{
			label: "File",
			items: [
				{ label: "New Thread", hint: bindingLabel("desktop.thread.new"), run: () => showNew() },
				"-",
				{ label: "Open Folder…", hint: bindingLabel("desktop.project.open"), run: () => void addProject() },
				{ label: "Archived Threads", run: () => navigate({ kind: "settings", page: "archived" }) },
				"-",
				{ label: "Close Window", hint: bindingLabel("desktop.window.close"), run: () => runAppCommand("close") },
				{ label: "Quit KnightCode", hint: bindingLabel("desktop.app.quit"), run: () => runAppCommand("quit") },
			],
		},
		{
			label: "Edit",
			items: [
				{ label: "Undo", hint: `${mod}Z`, run: () => runAppCommand("undo") },
				{ label: "Redo", hint: `${mod}Y`, run: () => runAppCommand("redo") },
				"-",
				{ label: "Cut", hint: `${mod}X`, run: () => runAppCommand("cut") },
				{ label: "Copy", hint: `${mod}C`, run: () => runAppCommand("copy") },
				{ label: "Paste", hint: `${mod}V`, run: () => runAppCommand("paste") },
				{ label: "Delete", run: () => runAppCommand("delete") },
				"-",
				{ label: "Select All", hint: `${mod}A`, run: () => runAppCommand("selectAll") },
				"-",
				{
					label: "Settings…",
					hint: bindingLabel("desktop.settings"),
					run: () => navigate({ kind: "settings", page: "general" }),
				},
			],
		},
		{
			label: "View",
			items: [
				{ label: "Command Palette", hint: bindingLabel("desktop.palette"), run: () => setPaletteOpen(true) },
				{
					label: sidebarOpen ? "Hide Sidebar" : "Show Sidebar",
					hint: bindingLabel("desktop.sidebar.toggle"),
					run: () => setSidebarOpen(!sidebarOpen),
				},
				"-",
				{
					label: "Find",
					hint: bindingLabel("desktop.thread.find"),
					disabled: !inThread,
					run: () => setFinding(true),
				},
				"-",
				{ label: "Back", hint: bindingLabel("desktop.nav.back"), run: () => goBack(-1) },
				{ label: "Forward", hint: bindingLabel("desktop.nav.forward"), run: () => goBack(1) },
				"-",
				{ label: "Zoom In", hint: bindingLabel("desktop.view.zoomIn"), run: () => runAppCommand("zoomIn") },
				{ label: "Zoom Out", hint: bindingLabel("desktop.view.zoomOut"), run: () => runAppCommand("zoomOut") },
				{ label: "Actual Size", hint: bindingLabel("desktop.view.zoomReset"), run: () => runAppCommand("resetZoom") },
				"-",
				{
					label: "Toggle Full Screen",
					hint: bindingLabel("desktop.view.fullScreen"),
					run: () => runAppCommand("toggleFullScreen"),
				},
				"-",
				{ label: "Reload", run: () => runAppCommand("reload") },
				{ label: "Developer Tools", run: () => runAppCommand("toggleDevTools") },
			],
		},
		{
			label: "Help",
			items: [
				{
					label: "Documentation",
					run: () => void client.host("host/shell/openExternal", { url: "https://knightcode.dev/docs" }),
				},
				{
					label: "Keyboard Shortcuts",
					hint: bindingLabel("desktop.shortcuts"),
					run: () => navigate({ kind: "settings", page: "shortcuts" }),
				},
				"-",
				// Last but About, and not on Linux, whose package manager updates the app.
				...(window.knightcode.platform === "linux"
					? []
					: [
							{
								label: "Check for Updates…",
								run: () => {
									navigate({ kind: "settings", page: "about" });
									checkForUpdates();
								},
							},
						]),
				{ label: "About KnightCode", run: () => navigate({ kind: "settings", page: "about" }) },
			],
		},
	];
}

/**
 * The update pill at the bar's end: 20px high, 10px semibold white on the accent blue,
 * shown only while there is something to do. Windows: "Downloading", then "Update", which quits and installs.
 * macOS: "Update" opens the newer release's page.
 */
function UpdatePill() {
	const update = useStore((s) => s.update);
	if (update.state !== "downloading" && update.state !== "ready" && update.state !== "available") return null;
	const tooltip =
		update.state === "downloading"
			? "Downloading an update"
			: update.state === "ready"
				? "Restart to update"
				: `KnightCode ${update.version} is available`;
	return (
		<button
			type="button"
			title={tooltip}
			aria-label={tooltip}
			disabled={update.state === "downloading"}
			onClick={() =>
				update.state === "available"
					? openUpdatePage(update.url)
					: installUpdate()
			}
			className="no-drag me-2 flex h-5 shrink-0 items-center gap-1 rounded-full bg-[var(--kc-update)] px-2.5 text-[10px] leading-3 font-semibold text-white shadow-sm enabled:hover:bg-[color-mix(in_srgb,var(--kc-update)_92%,black_8%)] enabled:active:bg-[color-mix(in_srgb,var(--kc-update)_80%,transparent)]"
		>
			<Download size={12} className="shrink-0" />
			{update.state === "downloading" ? "Downloading" : "Update"}
		</button>
	);
}

export function TitleBar() {
	const history = useStore((s) => s.history);
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const inThread = useStore((s) => s.view.kind === "thread");
	return (
		<div
			style={{ height: WINDOW_CHROME.titleBarHeight }}
			className={`drag flex shrink-0 items-center gap-1.5 bg-shell ${isMac() ? "ps-20 pe-2" : "ps-1.5 pe-36"}`}
		>
			<IconButton label="Back" strong className="no-drag" onClick={() => goBack(-1)} disabled={history.index === 0}>
				<ArrowLeft size={16} />
			</IconButton>
			<IconButton
				label="Forward"
				strong
				className="no-drag"
				onClick={() => goBack(1)}
				disabled={history.index >= history.stack.length - 1}
			>
				<ArrowRight size={16} />
			</IconButton>
			<IconButton
				label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
				strong
				className="no-drag"
				onClick={() => setSidebarOpen(!sidebarOpen)}
			>
				<PanelLeft size={16} filled={sidebarOpen} />
			</IconButton>
			{isMac() ? null : (
				<div role="menubar" aria-label="Application menu" className="flex items-center gap-0.5 ps-1 pe-2">
					{appMenus(sidebarOpen, inThread).map((menu) => (
						<AppMenu key={menu.label} label={menu.label} items={menu.items} />
					))}
				</div>
			)}
			<div className="flex-1" />
			<UpdatePill />
		</div>
	);
}
