/** Built-in title bar, using only public mediated commands and shared controls. */
import {
	defineDesktopExtension,
	experimental_controllers,
	experimental_controls,
	experimental_icons,
	experimental_shellServices,
	experimental_useNavigation,
	experimental_useUpdate,
} from "@knightcodeai/cli/desktop";
const runAppCommand = (
	command: Parameters<ReturnType<typeof experimental_controllers>["experimental_windowCommand"]>[0],
) => void experimental_controllers().experimental_windowCommand(command);

type AppMenuItem = { label: string; hint?: string; disabled?: boolean; run: () => void } | "-";

function AppMenu({ label, items }: { label: string; items: AppMenuItem[] }) {
	const {
		experimental_Menu: Menu,
		experimental_MenuTrigger: MenuTrigger,
		experimental_MenuContent: MenuContent,
		experimental_MenuItem: MenuItem,
		experimental_MenuSeparator: MenuSeparator,
	} = experimental_controls();
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

function appMenus(sidebarOpen: boolean, inThread: boolean): { label: string; items: AppMenuItem[] }[] {
	const { experimental_isMac: isMac, experimental_bindingLabel: bindingLabel } = experimental_shellServices();
	const {
		experimental_showNew: showNew,
		experimental_addProject: addProject,
		experimental_showSettings: showSettings,
		experimental_setSidebarOpen: setSidebarOpen,
		experimental_goBack: goBack,
	} = experimental_controllers();
	const {
		experimental_setFinding: setFinding,
		experimental_setPaletteOpen: setPaletteOpen,
		experimental_checkForUpdates: checkForUpdates,
	} = experimental_shellServices();
	const mod = isMac() ? "⌘" : "Ctrl+";
	return [
		{
			label: "File",
			items: [
				{ label: "New Thread", hint: bindingLabel("desktop.thread.new"), run: () => showNew() },
				"-",
				{ label: "Open Folder…", hint: bindingLabel("desktop.project.open"), run: () => void addProject() },
				{ label: "Archived Threads", run: () => showSettings("archived") },
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
					run: () => showSettings("general"),
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
				{ label: "Restart without extensions", run: () => runAppCommand("restartSafe") },
				{ label: "Developer Tools", run: () => runAppCommand("toggleDevTools") },
			],
		},
		{
			label: "Help",
			items: [
				{
					label: "Documentation",
					run: () => void experimental_shellServices().experimental_openDocumentation(),
				},
				{
					label: "Keyboard Shortcuts",
					hint: bindingLabel("desktop.shortcuts"),
					run: () => showSettings("shortcuts"),
				},
				"-",

				...(experimental_shellServices().experimental_platform === "linux"
					? []
					: [
							{
								label: "Check for Updates…",
								run: () => {
									showSettings("about");
									checkForUpdates();
								},
							},
						]),
				{ label: "About KnightCode", run: () => showSettings("about") },
			],
		},
	];
}

function UpdatePill() {
	const update = experimental_useUpdate();
	const { Download } = experimental_icons();
	const { experimental_installUpdate: installUpdate, experimental_openUpdatePage: openUpdatePage } =
		experimental_shellServices();
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
			onClick={() => (update.state === "available" ? openUpdatePage(update.url) : installUpdate())}
			className="no-drag me-2 flex h-5 shrink-0 items-center gap-1 rounded-full bg-[var(--kc-update)] px-2.5 text-[10px] leading-3 font-semibold text-white shadow-sm enabled:hover:bg-[color-mix(in_srgb,var(--kc-update)_92%,black_8%)] enabled:active:bg-[color-mix(in_srgb,var(--kc-update)_80%,transparent)]"
		>
			<Download size={12} className="shrink-0" />
			{update.state === "downloading" ? "Downloading" : "Update"}
		</button>
	);
}

export function TitleBar() {
	const { view, sidebarOpen, canGoBack, canGoForward } = experimental_useNavigation();
	const inThread = view.kind === "thread";
	const { experimental_isMac: isMac, experimental_titleBarHeight: titleBarHeight } = experimental_shellServices();
	const { experimental_goBack: goBack, experimental_setSidebarOpen: setSidebarOpen } = experimental_controllers();
	const { experimental_IconButton: IconButton } = experimental_controls();
	const { ArrowLeft, ArrowRight, PanelLeft } = experimental_icons();
	return (
		<div
			style={{ height: titleBarHeight }}
			className={`drag flex shrink-0 items-center gap-1.5 bg-shell ${isMac() ? "ps-20 pe-2" : "ps-1.5 pe-36"}`}
		>
			<IconButton label="Back" strong className="no-drag" onClick={() => goBack(-1)} disabled={!canGoBack}>
				<ArrowLeft size={16} />
			</IconButton>
			<IconButton label="Forward" strong className="no-drag" onClick={() => goBack(1)} disabled={!canGoForward}>
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

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "default", surface: "titleBar", experimental_render: TitleBar });
});
