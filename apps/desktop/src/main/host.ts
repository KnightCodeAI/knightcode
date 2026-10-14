/** Host methods: what a sandboxed renderer cannot do itself (desktop-shell.md section 4.4). */

import { app, type BrowserWindow, clipboard, dialog, shell } from "electron";
import { Compile } from "typebox/compile";
import { type HostMethod, HostMethods, type HostRequest, type HostResponse } from "../shared/host-protocol.ts";
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
		case "host/clipboard/writeText":
			clipboard.writeText(params.text as string);
			return {};
		case "host/window/setTitle":
			window.setTitle(params.title as string);
			return {};
		case "host/state/read":
			return state.read();
		case "host/state/write":
			state.write(params.state as Parameters<StateFile["write"]>[0]);
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
