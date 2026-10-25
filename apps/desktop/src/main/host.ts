/** Host methods: what a sandboxed renderer cannot do itself (desktop-shell.md section 4.4). */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import {
	app,
	type BrowserWindow,
	clipboard,
	dialog,
	Menu,
	type MenuItemConstructorOptions,
	nativeImage,
	shell,
	webContents,
} from "electron";
import { Compile } from "typebox/compile";
import {
	type HostMethod,
	HostMethods,
	type HostRequest,
	type HostResponse,
	type NativeMenuItem,
	WINDOW_CHROME,
} from "../shared/host-protocol.ts";
import { closeFromShortcut } from "./close.ts";
import type { DeclaredCsp, McpApps } from "./mcp-apps.ts";
import { InvalidParams, OpenIn, windowsIcons } from "./open-in.ts";
import { refuseToOpen } from "./open-path.ts";
import { setKeyOverrides } from "./preview.ts";
import { readProfile, signIn, signOut } from "./profile.ts";
import { saveCopy } from "./save-copy.ts";
import type { ServerConnection } from "./server.ts";
import type { StateFile } from "./state.ts";
import type { Terminals } from "./terminals.ts";

const checks = Object.fromEntries(
	Object.entries(HostMethods).map(([method, schema]) => [method, Compile(schema.params)]),
) as Record<HostMethod, ReturnType<typeof Compile>>;

/**
 * The window's material behind a translucent sidebar: acrylic on Windows 11 22H2 (build 22621) and later, with a
 * transparent background so it shows; vibrancy on macOS. Elsewhere, or when off, the window is opaque again.
 */
function setMaterial(window: BrowserWindow, translucent: boolean, background: string): boolean {
	if (process.platform === "darwin") {
		window.setVibrancy(translucent ? "sidebar" : null);
		return translucent;
	}
	const build = Number(process.getSystemVersion().split(".")[2] ?? 0);
	const supported = process.platform === "win32" && build >= 22621;
	if (!supported) return false;
	window.setBackgroundMaterial(translucent ? "acrylic" : "none");
	window.setBackgroundColor(translucent ? "#00000000" : background);
	return translucent;
}

/** "Open in" over Electron: app icons, the file manager, the default app behind refuseToOpen. */
export function openInService(env: NodeJS.ProcessEnv): OpenIn {
	return new OpenIn({
		platform: process.platform,
		env,
		icons: async (paths) => {
			if (process.platform === "win32") return windowsIcons(paths, env);
			const icons = new Map<string, string>();
			for (const path of paths) {
				const image = await app.getFileIcon(path, { size: "normal" }).catch(() => undefined);
				if (image && !image.isEmpty()) icons.set(path, image.toDataURL());
			}
			return icons;
		},
		// A terminal's Start menu shortcut is followed to its program; an unreadable one is no target.
		readShortcut: (lnk) => {
			try {
				return shell.readShortcutLink(lnk).target || undefined;
			} catch {
				return undefined;
			}
		},
		reveal: async (path) => {
			// A file is shown selected in its folder; a folder, or the nearest one still there, is opened.
			let at = path;
			while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
			if (statSync(at).isFile()) return shell.showItemInFolder(at);
			const failure = await shell.openPath(at);
			if (failure) throw new Error(failure);
		},
		openDefault: async (path) => {
			const refused = refuseToOpen(path);
			if (refused) throw new Error(refused);
			const failure = await shell.openPath(path);
			if (failure) throw new Error(failure);
		},
	});
}

/** A private PNG beside pasted images, which the app server reads by path. */
function savePng(png: Buffer): string {
	const dir = join(app.getPath("temp"), "knightcode-desktop-paste");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = join(dir, `${randomUUID()}.png`);
	writeFileSync(path, png, { mode: 0o600 });
	return path;
}

/** What host methods reach beyond their window: the state file, the server, and opening another window on a route. */
export interface HostDeps {
	state: StateFile;
	server: ServerConnection;
	openIn: OpenIn;
	terminals: Terminals;
	mcpApps: McpApps;
	/** The requesting window's id, which terminal events are posted to. */
	windowId: number;
	openWindow: (route?: string) => void;
	/** Step the window's zoom (-1 out, 1 in, 0 back to 100%). */
	zoom: (window: BrowserWindow, step: -1 | 0 | 1) => void;
	/** host/window/role for the requesting window. */
	role: () => { primary: boolean; heldElsewhere: string[] };
}

export async function handleHost(request: HostRequest, window: BrowserWindow, deps: HostDeps): Promise<HostResponse> {
	const check = Object.hasOwn(checks, request.host) ? checks[request.host] : undefined;
	if (!check?.Check(request.params))
		return { id: request.id, error: { code: "invalidParams", message: `invalid host request ${request.host}` } };
	const params = request.params as Record<string, unknown>;
	try {
		return { id: request.id, result: await run(request.host, params, window, deps) };
	} catch (error) {
		return {
			id: request.id,
			error: {
				code: error instanceof InvalidParams ? error.code : "internal",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

async function run(
	method: HostMethod,
	params: Record<string, unknown>,
	window: BrowserWindow,
	{ state, server, openIn, terminals, mcpApps, windowId, openWindow, zoom, role }: HostDeps,
): Promise<unknown> {
	switch (method) {
		case "host/mcpApp/serve":
			return mcpApps.serve(params.html as string, params.csp as DeclaredCsp | undefined, windowId);
		case "host/mcpApp/release":
			mcpApps.release(params.id as string);
			return {};
		case "host/terminal/shells":
			return { shells: terminals.shells().map(({ id, name }) => ({ id, name })) };
		case "host/terminal/create":
			return terminals.create(params as Parameters<Terminals["create"]>[0], windowId);
		case "host/terminal/list":
			return { terminals: terminals.list(params.threadId as string) };
		case "host/terminal/attach":
			return terminals.attach(params.terminalId as string, windowId);
		case "host/terminal/write":
			terminals.write(params.terminalId as string, params.data as string);
			return {};
		case "host/terminal/resize":
			terminals.resize(params.terminalId as string, params.cols as number, params.rows as number);
			return {};
		case "host/terminal/kill":
			terminals.kill(params.terminalId as string);
			return {};
		case "host/openIn/list":
			return { targets: await openIn.list() };
		case "host/openIn/open":
			await openIn.open(
				params.targetId as string,
				params.path as string,
				params.line as number | undefined,
				params.column as number | undefined,
			);
			return {};
		case "host/file/saveCopy": {
			const path = params.path as string;
			if (!isAbsolute(path)) throw new InvalidParams(`not an absolute path: ${path}`);
			const saved = await saveCopy(path, async (proposed) => {
				const result = window
					? await dialog.showSaveDialog(window, { defaultPath: proposed })
					: await dialog.showSaveDialog({ defaultPath: proposed });
				return result.canceled ? undefined : result.filePath;
			});
			// The Dock's Downloads stack bounces, as for a finished download.
			if (saved && process.platform === "darwin") app.dock?.downloadFinished(saved);
			return saved ? { path: saved } : {};
		}
		case "host/menu/popup":
			return popupMenu(params.items as NativeMenuItem[], window);
		case "host/dialog/openFolder": {
			const result = await dialog.showOpenDialog(window, {
				title: (params.title as string | undefined) ?? "Add a project",
				properties: ["openDirectory", "createDirectory"],
			});
			return result.canceled || !result.filePaths[0] ? {} : { path: result.filePaths[0] };
		}
		case "host/shell/openExternal": {
			const url = new URL(params.url as string);
			if (!["http:", "https:", "mailto:"].includes(url.protocol))
				throw new Error("only http, https and mailto links open");
			await shell.openExternal(url.toString());
			return {};
		}
		case "host/shell/showInFolder":
			shell.showItemInFolder(params.path as string);
			return {};
		case "host/profile/read":
			return readProfile();
		case "host/profile/signIn":
			return signIn();
		case "host/profile/signOut":
			await signOut();
			return {};
		case "host/shell/openPath": {
			const refused = refuseToOpen(params.path as string);
			if (refused) throw new Error(refused);
			const failure = await shell.openPath(params.path as string);
			if (failure) throw new Error(failure);
			return {};
		}
		case "host/clipboard/writeText":
			await clipboard.writeText(params.text as string);
			return {};
		case "host/clipboard/readText":
			return { text: clipboard.readText() };
		case "host/window/setTitle":
			window.setTitle(params.title as string);
			return {};
		case "host/window/open":
			openWindow(params.threadId ? `knightcode://thread/${encodeURIComponent(params.threadId as string)}` : undefined);
			return {};
		case "host/window/role":
			return role();
		case "host/state/read":
			return state.read();
		case "host/state/write":
			state.write(params.state as Parameters<StateFile["write"]>[0]);
			return {};
		case "host/dialog/openFiles": {
			const result = await dialog.showOpenDialog(window, {
				properties: ["openFile", "multiSelections"],
				filters: params.images ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] : [],
			});
			return { paths: result.canceled ? [] : result.filePaths };
		}
		case "host/clipboard/readImage": {
			// The app server reads images by path (architecture.md section 4.2), so a paste becomes a private file.
			const item = (await clipboard.read()).find((i) => i.types.includes("image/png"));
			if (!item) return {};
			const blob = await item.getType("image/png");
			return { path: savePng(Buffer.from(await blob.arrayBuffer())) };
		}
		case "host/preview/capture": {
			const guest = webContents.fromId(params.webContentsId as number);
			if (!guest || guest.hostWebContents !== window.webContents)
				throw new InvalidParams("not a preview of this window");
			const image = await guest.capturePage(params.rect as Electron.Rectangle);
			if (image.isEmpty()) throw new Error("the page drew nothing there");
			return { path: savePng(image.toPNG()) };
		}
		case "host/keys/set":
			setKeyOverrides(params.overrides as Record<string, string[]>);
			return {};
		case "host/image/thumbnail": {
			// The renderer cannot read files; a small data URL is enough for an attachment chip.
			const image = nativeImage.createFromPath(params.path as string);
			return image.isEmpty() ? {} : { dataUrl: image.resize({ height: 96 }).toDataURL() };
		}
		case "host/window/setTheme": {
			const chrome = WINDOW_CHROME[params.dark ? "dark" : "light"];
			if (process.platform === "win32")
				window.setTitleBarOverlay({
					color: "#00000000",
					symbolColor: chrome.symbol,
					height: Math.round(WINDOW_CHROME.titleBarHeight * window.webContents.getZoomFactor()),
				});
			return { translucent: setMaterial(window, params.translucent === true, chrome.background) };
		}
		case "host/app/command": {
			const contents = window.webContents;
			switch (params.command as string) {
				case "undo":
					contents.undo();
					break;
				case "redo":
					contents.redo();
					break;
				case "cut":
					contents.cut();
					break;
				case "copy":
					contents.copy();
					break;
				case "paste":
					contents.paste();
					break;
				case "delete":
					contents.delete();
					break;
				case "selectAll":
					contents.selectAll();
					break;
				case "reload":
					contents.reload();
					break;
				case "toggleDevTools":
					if (!app.isPackaged) contents.toggleDevTools();
					break;
				case "zoomIn":
					zoom(window, 1);
					break;
				case "zoomOut":
					zoom(window, -1);
					break;
				case "resetZoom":
					zoom(window, 0);
					break;
				case "minimize":
					window.minimize();
					break;
				case "toggleMaximize":
					if (window.isMaximized()) window.unmaximize();
					else window.maximize();
					break;
				case "toggleFullScreen":
					window.setFullScreen(!window.isFullScreen());
					break;
				case "close":
					closeFromShortcut(window, state);
					break;
				case "focus":
					if (window.isMinimized()) window.restore();
					window.show();
					window.focus();
					break;
				case "quit":
					app.quit();
					break;
			}
			return {};
		}
		case "host/server/restart":
			server.restart();
			return {};
		case "host/app/info":
			return {
				appVersion: app.getVersion(),
				serverVersion: server.initializeResult?.serverInfo.version ?? "",
				platform: process.platform,
				logsDir: app.getPath("logs"),
			};
	}
}

/** A native context menu at the pointer, as Codex shows for its rows; resolves with the chosen id once it closes. */
function popupMenu(items: NativeMenuItem[], window: BrowserWindow): Promise<{ id?: string }> {
	let chosen: string | undefined;
	const build = (list: NativeMenuItem[]): MenuItemConstructorOptions[] =>
		list.map((item) => {
			if ("separator" in item) return { type: "separator" };
			if ("submenu" in item) return { label: item.label, submenu: build(item.submenu) };
			return {
				label: item.label,
				enabled: item.enabled ?? true,
				...(item.accelerator ? { accelerator: item.accelerator, registerAccelerator: false } : {}),
				click: () => {
					chosen = item.id;
				},
			};
		});
	return new Promise((resolve) => {
		// The menu closes before its click handler runs; let the click land first.
		Menu.buildFromTemplate(build(items)).popup({
			window,
			callback: () => setTimeout(() => resolve(chosen ? { id: chosen } : {}), 0),
		});
	});
}
