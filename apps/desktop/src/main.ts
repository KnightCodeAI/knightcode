/**
 * Electron main (desktop-shell.md sections 3-6): one app server child, windows that reach it through
 * one MessagePort each, and the host methods a sandboxed renderer cannot run itself.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Message } from "@knightcode/app-server-protocol";
import {
	app,
	BrowserWindow,
	dialog,
	MessageChannelMain,
	type MessagePortMain,
	Menu,
	nativeTheme,
	net,
	protocol,
	session,
	shell,
} from "electron";
import { type HostEvent, type HostRequest, WINDOW_CHROME } from "./shared/host-protocol.ts";
import { markQuitting, onWindowClose } from "./main/close.ts";
import { handleHost, openInService } from "./main/host.ts";
import type { OpenIn } from "./main/open-in.ts";
import { MCP_APP_SCHEME, McpApps } from "./main/mcp-apps.ts";
import { clearPreview, guardWebviews } from "./main/preview.ts";
import { rendererPath } from "./main/protocol-scheme.ts";
import { Router } from "./main/router.ts";
import { resolveServerCommand, ServerConnection, type ServerState } from "./main/server.ts";
import { loginShellEnv } from "./main/shell-env.ts";
import { StateFile } from "./main/state.ts";
import { type SpawnPty, Terminals } from "./main/terminals.ts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const DEV_URL = MAIN_WINDOW_VITE_DEV_SERVER_URL;
const ORIGIN = DEV_URL ? new URL(DEV_URL).origin : "app://desktop";
const RENDERER_DIR = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
const CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com; " +
	"font-src 'self'; connect-src 'self'; frame-src kc-mcp-app:; worker-src 'self' blob:";

protocol.registerSchemesAsPrivileged([
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
	// MCP Apps' documents, one origin per app instance (main/mcp-apps.ts).
	{ scheme: MCP_APP_SCHEME, privileges: { standard: true, secure: true } },
]);

interface OpenWindow {
	window: BrowserWindow;
	port: MessagePortMain | undefined;
	lastFocusedAt: number;
	/** A `knightcode://` link to show once the page has its port (section 6.1). */
	route: string | undefined;
}

const LINK_PREFIX = "knightcode://";
/** The `knightcode://` link among a launch's arguments, if any. */
const linkIn = (argv: string[]) => argv.find((arg) => arg.startsWith(LINK_PREFIX));

const windows = new Map<number, OpenWindow>();
let nextWindowId = 1;
let serverState: { state: ServerState; message?: string } = { state: "starting" };
let quitting = false;

/** host/window/role: the focused window, else the one focused last, acts for all; and what the others hold. */
function roleOf(id: number): { primary: boolean; heldElsewhere: string[] } {
	const all = [...windows];
	const primary = all.find(([, w]) => w.window.isFocused()) ?? all.sort(([, a], [, b]) => b.lastFocusedAt - a.lastFocusedAt)[0];
	const heldElsewhere = new Set(all.filter(([other]) => other !== id).flatMap(([other]) => router.heldThreads(other)));
	return { primary: primary?.[0] === id, heldElsewhere: [...heldElsewhere] };
}

function sendEvent(target: OpenWindow, event: HostEvent): void {
	target.port?.postMessage(event);
}

/**
 * Codex's window zoom: 10% steps from 50% to 300%, the caption buttons' overlay as tall as the zoomed title bar, and
 * the level shown in the window that changed it. Chromium zooms by origin, so every window follows.
 */
function zoom(window: BrowserWindow, step: -1 | 0 | 1): void {
	const contents = window.webContents;
	const factor = step === 0 ? 1 : Math.min(3, Math.max(0.5, Math.round(contents.getZoomFactor() * 10 + step) / 10));
	contents.setZoomFactor(factor);
	for (const open of windows.values()) {
		if (process.platform === "win32")
			open.window.setTitleBarOverlay({
				// The new factor for every window: one origin, and another window's own reading can lag.
				height: Math.round(WINDOW_CHROME.titleBarHeight * factor),
			});
		if (open.window === window) sendEvent(open, { event: "zoom", factor });
	}
}

const router = new Router({
	send: (message) => server.send(message),
	initializeResult: () => server.initializeResult,
});

const state = new StateFile(app.getPath("userData"));
// An app's frame may sit only in this app's own windows.
const mcpApps = new McpApps(ORIGIN);
let server: ServerConnection;
let openIn: OpenIn;
let terminals: Terminals;

/** Serves only the built renderer directory; `..` never escapes it (section 6.3). */
function serveRenderer(request: Request): Promise<Response> | Response {
	const url = new URL(request.url);
	if (url.host !== "desktop") return new Response(null, { status: 404 });
	const path = rendererPath(RENDERER_DIR, url.pathname);
	if (typeof path === "number") return new Response(null, { status: path });
	return net.fetch(pathToFileURL(path).toString()).then((response) => {
		const headers = new Headers(response.headers);
		headers.set("Content-Security-Policy", CSP);
		return new Response(response.body, { status: response.status, headers });
	});
}

function connectPort(id: number, open: OpenWindow): void {
	open.port?.close();
	router.detach(id);
	// The reloaded page attaches to the terminals it shows again, getting their output so far first.
	terminals.detachWindow(id);
	const { port1, port2 } = new MessageChannelMain();
	open.port = port1;
	router.attach({
		id,
		send: (message) => port1.postMessage(message),
		isFocused: () => open.window.isFocused(),
		lastFocusedAt: () => open.lastFocusedAt,
	});
	port1.on("message", (event) => {
		const data = event.data as Message | HostRequest;
		if (typeof data !== "object" || data === null) return;
		if ("host" in data) {
			void handleHost(data, open.window, {
				state,
				server,
				openIn,
				terminals,
				mcpApps,
				windowId: id,
				openWindow: createWindow,
				zoom,
				role: () => roleOf(id),
			}).then((response) => port1.postMessage(response));
			return;
		}
		router.fromWindow(id, data);
	});
	port1.start();
	open.window.webContents.postMessage("kc:port", null, [port2]);
	sendEvent(open, { event: "server/state", ...serverState });
	if (open.route) sendEvent(open, { event: "navigate", route: open.route });
	open.route = undefined;
}

/**
 * Show a `knightcode://` link (section 6.1): a thread in the window already holding it, anything else (or a thread no
 * window holds) in the window used last; a new window when none is open.
 */
function openLink(url: string): void {
	const encoded = /^knightcode:\/\/thread\/([^/?#]+)/.exec(url)?.[1];
	let threadId: string | undefined;
	try {
		threadId = encoded && decodeURIComponent(encoded);
	} catch {
		// A bad %-escape (any page can send the link): no window holds it; the renderer shows nothing for it.
	}
	const all = [...windows];
	const holding = threadId ? all.find(([id]) => router.heldThreads(id).includes(threadId)) : undefined;
	const target = holding ?? all.sort(([, a], [, b]) => b.lastFocusedAt - a.lastFocusedAt)[0];
	if (!target) return void createWindow(url);
	const [, open] = target;
	if (open.window.isMinimized()) open.window.restore();
	open.window.focus();
	if (open.port) sendEvent(open, { event: "navigate", route: url });
	else open.route = url;
}

function createWindow(route?: string): BrowserWindow {
	const id = nextWindowId++;
	const dark = nativeTheme.shouldUseDarkColors;
	const window = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 720,
		minHeight: 480,
		show: false,
		title: "KnightCode",
		backgroundColor: WINDOW_CHROME[dark ? "dark" : "light"].background,
		...(process.platform === "darwin"
			? { titleBarStyle: "hiddenInset" as const }
			: process.platform === "win32"
				? {
						titleBarStyle: "hidden" as const,
						titleBarOverlay: {
							color: "#00000000",
							symbolColor: WINDOW_CHROME[dark ? "dark" : "light"].symbol,
							height: WINDOW_CHROME.titleBarHeight,
						},
					}
				: {}),
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			// Preview tabs (section 9.8); main/preview.ts decides what each one may attach and do.
			webviewTag: true,
			preload: join(__dirname, "preload.cjs"),
			additionalArguments: [`--kc-origin=${ORIGIN}`, `--kc-window-id=${id}`],
		},
	});
	const open: OpenWindow = { window, port: undefined, lastFocusedAt: Date.now(), route };
	windows.set(id, open);
	window.on("focus", () => {
		open.lastFocusedAt = Date.now();
	});
	guardWebviews(window.webContents, (binding) => sendEvent(open, { event: "key", binding }));
	window.on("close", (event) => onWindowClose(window, state, event));
	window.once("ready-to-show", () => window.show());
	// A reload gets a fresh port; the old one's holds are released and the page resumes what it shows.
	window.webContents.on("did-finish-load", () => connectPort(id, open));
	// The page never leaves itself; a reload (Vite's, or the store's after a hot update) is a navigation to its own URL.
	window.webContents.on("will-navigate", (event) => {
		if (event.url !== window.webContents.getURL()) event.preventDefault();
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	let lastCrash = 0;
	window.webContents.on("render-process-gone", () => {
		const now = Date.now();
		if (now - lastCrash > 60_000) window.webContents.reload();
		lastCrash = now;
	});
	window.on("closed", () => {
		open.port?.close();
		router.detach(id);
		terminals.detachWindow(id);
		mcpApps.releaseWindow(id);
		windows.delete(id);
	});
	void (DEV_URL ? window.loadURL(DEV_URL) : window.loadURL("app://desktop/index.html"));
	return window;
}

/**
 * What a thread holds in main ends with it: its terminals when it is archived or deleted (section 9.7), its preview
 * storage when it is deleted (section 9.8).
 */
function endThread(message: Message): void {
	if (!("method" in message) || "id" in message) return;
	const params = message.params as { threadId?: string; archived?: boolean } | undefined;
	if (!params?.threadId) return;
	if ((message.method === "thread/archived" && params.archived) || message.method === "thread/deleted")
		terminals.killThread(params.threadId);
	if (message.method === "thread/deleted") void clearPreview(app.getPath("userData"), params.threadId).catch(() => {});
}

function zoomFocused(step: -1 | 0 | 1): void {
	const window = BrowserWindow.getFocusedWindow();
	if (window) zoom(window, step);
}

function buildMenu(): void {
	const template: Electron.MenuItemConstructorOptions[] = [
		...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
				{ type: "separator" },
				// The roles' accelerators, through zoom() so the steps and the banner match the renderer's.
				{ label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => zoomFocused(0) },
				{ label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => zoomFocused(1) },
				{ label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => zoomFocused(-1) },
			],
		},
		{ role: "windowMenu" },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start(): Promise<void> {
	await app.whenReady();
	protocol.handle("app", serveRenderer);
	protocol.handle(MCP_APP_SCHEME, (request) => mcpApps.handle(request));
	session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
		// local-fonts: Settings › Appearance lists the installed fonts (queryLocalFonts).
		callback(permission === "clipboard-sanitized-write" || permission === "notifications" || permission === "local-fonts"),
	);
	buildMenu();
	const env = await loginShellEnv();
	// Editors launch with the user's own PATH, as the server's tools run with it.
	openIn = openInService(env);
	terminals = new Terminals({
		platform: process.platform,
		env,
		// Loaded as Codex loads it, outside the bundle: a native module the main build leaves in node_modules.
		spawn: () => (createRequire(__filename)("node-pty") as { spawn: SpawnPty }).spawn,
		post: (windowId, event) => {
			const open = windows.get(windowId);
			if (open) sendEvent(open, event);
		},
	});
	server = new ServerConnection({
		command: resolveServerCommand(app.isPackaged, app.getAppPath(), process.resourcesPath),
		env,
		logsDir: app.getPath("logs"),
		clientVersion: app.getVersion(),
		onMessage: (message) => {
			router.fromServer(message);
			endThread(message);
		},
		onState: (next, message) => {
			serverState = { state: next, message };
			for (const open of windows.values()) sendEvent(open, { event: "server/state", state: next, message });
		},
		onExit: () => router.serverRestarted(),
	});
	server.start();
	// A source checkout would register the bare Electron binary as the link handler; only an installed app does.
	if (app.isPackaged) app.setAsDefaultProtocolClient("knightcode");
	createWindow(linkIn(process.argv) ?? pendingLink);
	pendingLink = undefined;
	app.on("activate", () => {
		if (windows.size === 0) createWindow();
	});
}

/** A link macOS delivered before start() opened the first window. */
let pendingLink: string | undefined;

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const link = linkIn(argv);
		// Before start() made the first window: a link waits for it, and a plain launch is that window anyway.
		if (!server) {
			if (link) pendingLink = link;
			return;
		}
		if (link) return openLink(link);
		const first = windows.values().next().value as OpenWindow | undefined;
		if (!first) return void createWindow();
		if (first.window.isMinimized()) first.window.restore();
		first.window.focus();
	});
	// macOS hands links to the running app as an event, not as arguments.
	app.on("open-url", (event, url) => {
		event.preventDefault();
		// Before start() made the first window the link waits for it; after, openLink opens a window when none is
		// left (macOS keeps the app running with every window closed).
		if (server) openLink(url);
		else pendingLink = url;
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	app.on("before-quit", (event) => {
		if (quitting || !server) return markQuitting();
		event.preventDefault();
		const running = router.activeThreads();
		if (running > 0) {
			const options = {
				type: "warning" as const,
				buttons: ["Quit", "Cancel"],
				defaultId: 1,
				cancelId: 1,
				message: `${running} ${running === 1 ? "thread is" : "threads are"} running. Quit and interrupt ${running === 1 ? "it" : "them"}?`,
			};
			const parent = BrowserWindow.getFocusedWindow();
			const choice = parent ? dialog.showMessageBoxSync(parent, options) : dialog.showMessageBoxSync(options);
			if (choice !== 0) return;
		}
		quitting = true;
		markQuitting();
		void server.stop().finally(() => {
			terminals.killAll();
			app.quit();
		});
	});
	void start();
}
