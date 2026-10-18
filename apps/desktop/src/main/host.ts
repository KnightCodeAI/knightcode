/** Host methods: what a sandboxed renderer cannot do itself (desktop-shell.md section 4.4). */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow, clipboard, dialog, nativeImage, shell } from "electron";
import { Compile } from "typebox/compile";
import { type HostMethod, HostMethods, type HostRequest, type HostResponse } from "../shared/host-protocol.ts";
import { refuseToOpen } from "./open-path.ts";
import type { ServerConnection } from "./server.ts";
import type { StateFile } from "./state.ts";

const checks = Object.fromEntries(
	Object.entries(HostMethods).map(([method, schema]) => [method, Compile(schema.params)]),
) as Record<HostMethod, ReturnType<typeof Compile>>;

export async function handleHost(
	request: HostRequest,
	window: BrowserWindow,
	deps: { state: StateFile; server: ServerConnection },
): Promise<HostResponse> {
	const check = Object.hasOwn(checks, request.host) ? checks[request.host] : undefined;
	if (!check?.Check(request.params))
		return { id: request.id, error: { code: "invalidParams", message: `invalid host request ${request.host}` } };
	const params = request.params as Record<string, unknown>;
	try {
		return { id: request.id, result: await run(request.host, params, window, deps) };
	} catch (error) {
		return {
			id: request.id,
			error: { code: "internal", message: error instanceof Error ? error.message : String(error) },
		};
	}
}

async function run(
	method: HostMethod,
	params: Record<string, unknown>,
	window: BrowserWindow,
	{ state, server }: { state: StateFile; server: ServerConnection },
): Promise<unknown> {
	switch (method) {
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
		case "host/window/setTitle":
			window.setTitle(params.title as string);
			return {};
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
			const dir = join(app.getPath("temp"), "knightcode-desktop-paste");
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			const path = join(dir, `${randomUUID()}.png`);
			writeFileSync(path, Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
			return { path };
		}
		case "host/image/thumbnail": {
			// The renderer cannot read files; a small data URL is enough for an attachment chip.
			const image = nativeImage.createFromPath(params.path as string);
			return image.isEmpty() ? {} : { dataUrl: image.resize({ height: 96 }).toDataURL() };
		}
		case "host/window/setTheme":
			if (process.platform === "win32")
				window.setTitleBarOverlay({ color: "#00000000", symbolColor: params.dark ? "#ececec" : "#1a1c1f", height: 40 });
			return {};
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
					contents.setZoomLevel(contents.getZoomLevel() + 0.5);
					break;
				case "zoomOut":
					contents.setZoomLevel(contents.getZoomLevel() - 0.5);
					break;
				case "resetZoom":
					contents.setZoomLevel(0);
					break;
				case "minimize":
					window.minimize();
					break;
				case "toggleMaximize":
					if (window.isMaximized()) window.unmaximize();
					else window.maximize();
					break;
				case "close":
					window.close();
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
