/**
 * Electron main (desktop-shell.md sections 3-6): one app server child, windows that reach it through
 * one MessagePort each, and the host methods a sandboxed renderer cannot run itself.
 */

import { join, normalize, relative, sep } from "node:path";
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
import type { HostEvent, HostRequest } from "./shared/host-protocol.ts";
import { handleHost } from "./main/host.ts";
import { Router } from "./main/router.ts";
import { resolveServerCommand, ServerConnection, type ServerState } from "./main/server.ts";
import { loginShellEnv } from "./main/shell-env.ts";
import { StateFile } from "./main/state.ts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const DEV_URL = MAIN_WINDOW_VITE_DEV_SERVER_URL;
const ORIGIN = DEV_URL ? new URL(DEV_URL).origin : "app://desktop";
const RENDERER_DIR = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
const CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
	"font-src 'self'; connect-src 'self'; frame-src kc-ext:; worker-src 'self' blob:";

protocol.registerSchemesAsPrivileged([
	{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

interface OpenWindow {
	window: BrowserWindow;
	port: MessagePortMain | undefined;
	lastFocusedAt: number;
}

const windows = new Map<number, OpenWindow>();
let nextWindowId = 1;
let serverState: { state: ServerState; message?: string } = { state: "starting" };
let quitting = false;

function sendEvent(target: OpenWindow, event: HostEvent): void {
	target.port?.postMessage(event);
}

const router = new Router({
	send: (message) => server.send(message),
	initializeResult: () => server.initializeResult,
});

const state = new StateFile(app.getPath("userData"));
let server: ServerConnection;

/** Serves only the built renderer directory; `..` never escapes it (section 6.3). */
function serveRenderer(request: Request): Promise<Response> | Response {
	const url = new URL(request.url);
	if (url.host !== "desktop") return new Response(null, { status: 404 });
	let decoded: string;
	try {
		decoded = decodeURIComponent(url.pathname);
	} catch {
		return new Response(null, { status: 400 });
	}
	const path = normalize(join(RENDERER_DIR, decoded));
	const inside = relative(RENDERER_DIR, path);
	if (inside.startsWith("..") || inside.includes(`..${sep}`)) return new Response(null, { status: 403 });
	return net.fetch(pathToFileURL(path).toString()).then((response) => {
		const headers = new Headers(response.headers);
		headers.set("Content-Security-Policy", CSP);
		return new Response(response.body, { status: response.status, headers });
	});
}

function connectPort(id: number, open: OpenWindow): void {
	open.port?.close();
	router.detach(id);
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
			void handleHost(data, open.window, { state, server }).then((response) => port1.postMessage(response));
			return;
		}
		router.fromWindow(id, data);
	});
	port1.start();
	open.window.webContents.postMessage("kc:port", null, [port2]);
	sendEvent(open, { event: "server/state", ...serverState });
}

function createWindow(): BrowserWindow {
	const id = nextWindowId++;
	const dark = nativeTheme.shouldUseDarkColors;
	const window = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 720,
		minHeight: 480,
		show: false,
		title: "KnightCode",
		backgroundColor: dark ? "#17140f" : "#fbf9f6",
		...(process.platform === "darwin"
			? { titleBarStyle: "hiddenInset" as const }
			: process.platform === "win32"
				? {
						titleBarStyle: "hidden" as const,
						titleBarOverlay: { color: "#00000000", symbolColor: dark ? "#e7e2db" : "#2b2620", height: 40 },
					}
				: {}),
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			preload: join(__dirname, "preload.cjs"),
			additionalArguments: [`--kc-origin=${ORIGIN}`, `--kc-window-id=${id}`],
		},
	});
	const open: OpenWindow = { window, port: undefined, lastFocusedAt: Date.now() };
	windows.set(id, open);
	window.on("focus", () => {
		open.lastFocusedAt = Date.now();
	});
	window.once("ready-to-show", () => window.show());
	// A reload gets a fresh port; the old one's holds are released and the page resumes what it shows.
	window.webContents.on("did-finish-load", () => connectPort(id, open));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
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
		windows.delete(id);
	});
	void (DEV_URL ? window.loadURL(DEV_URL) : window.loadURL("app://desktop/index.html"));
	return window;
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
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
			],
		},
		{ role: "windowMenu" },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start(): Promise<void> {
	await app.whenReady();
	protocol.handle("app", serveRenderer);
	session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
		callback(permission === "clipboard-sanitized-write" || permission === "notifications"),
	);
	buildMenu();
	server = new ServerConnection({
		command: resolveServerCommand(app.isPackaged, app.getAppPath(), process.resourcesPath),
		env: await loginShellEnv(),
		logsDir: app.getPath("logs"),
		clientVersion: app.getVersion(),
		onMessage: (message) => router.fromServer(message),
		onState: (next, message) => {
			serverState = { state: next, message };
			for (const open of windows.values()) sendEvent(open, { event: "server/state", state: next, message });
		},
		onExit: () => router.serverRestarted(),
	});
	server.start();
	createWindow();
	app.on("activate", () => {
		if (windows.size === 0) createWindow();
	});
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		const first = windows.values().next().value as OpenWindow | undefined;
		if (!first) return void createWindow();
		if (first.window.isMinimized()) first.window.restore();
		first.window.focus();
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
	app.on("before-quit", (event) => {
		if (quitting || !server) return;
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
		void server.stop().finally(() => app.quit());
	});
	void start();
}
