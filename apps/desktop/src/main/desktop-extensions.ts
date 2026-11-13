/** Main's native-consent gate and window leases over the app server's immutable artifacts. */
import { DesktopExtensionRequests, type ParamsOf } from "@knightcode/app-server-protocol";
import { type BrowserWindow, dialog } from "electron";
import { Compile } from "typebox/compile";
import { DesktopExtensionHostMethods } from "../shared/desktop-extensions.ts";
import type { HostRequest, HostResponse, HostParams } from "../shared/host-protocol.ts";
import type { ExtensionArtifacts } from "./extension-artifacts.ts";
import type { ServerConnection } from "./server.ts";
import type { ExtensionProviderPreferences } from "./extension-preferences.ts";

const checks = Object.fromEntries(
	Object.entries(DesktopExtensionHostMethods).map(([method, schema]) => [method, Compile(schema.params)]),
);
const checkList = Compile(DesktopExtensionRequests["desktopExtension/list"].result);

export async function handleDesktopExtensions(
	request: HostRequest,
	window: BrowserWindow,
	windowId: number,
	services: {
		server: ServerConnection;
		artifacts: ExtensionArtifacts;
		safeMode: boolean;
		providers: ExtensionProviderPreferences;
		providersChanged(): void;
		isCurrent(): boolean;
	},
): Promise<HostResponse> {
	const { server, artifacts, safeMode, providers } = services;
	if (!checks[request.host]?.Check(request.params))
		return { id: request.id, error: { code: "invalidParams", message: "Invalid desktop extension host request." } };
	try {
		let result: unknown = {};
		switch (request.host) {
			case "host/desktopExtension/list": {
				const params = request.params as HostParams<"host/desktopExtension/list">;
				if (params.runtime) artifacts.runtime(params.runtime);
				const snapshot = await server.request("desktopExtension/list", params.cwd ? { cwd: params.cwd } : {});
				if (!checkList.Check(snapshot)) throw new Error("Malformed desktop extension list from app server.");
				if (safeMode) {
					artifacts.clear();
					result = {
						...snapshot,
						safeMode: true,
						providers: providers.read(windowId),
						extensions: snapshot.extensions.map(({ artifact: _artifact, ...entry }) => entry),
					};
				} else {
					result = { ...snapshot, providers: providers.read(windowId) };
				}
				break;
			}
			case "host/desktopExtension/acquire": {
				if (safeMode) throw new Error("External artifacts are disabled in safe mode.");
				const params = request.params as HostParams<"host/desktopExtension/acquire">;
				const snapshot = await server.request("desktopExtension/list", {});
				if (!checkList.Check(snapshot)) throw new Error("Malformed desktop extension list.");
				const artifact = snapshot.extensions.find(
					(entry) => entry.owner === params.owner && entry.artifact?.revision === params.revision,
				)?.artifact;
				if (!artifact || !services.isCurrent())
					throw new Error("The artifact or requesting window is no longer available.");
				artifacts.register(artifact, windowId, params.lease);
				break;
			}
			case "host/desktopExtension/provider/set": {
				const { surface, provider, scope } = request.params as HostParams<"host/desktopExtension/provider/set">;
				providers.set(surface, provider, scope, windowId);
				services.providersChanged();
				break;
			}
			case "host/desktopExtension/set": {
				const params = request.params as ParamsOf<"desktopExtension/set">;
				if (params.approve) {
					const snapshot = await server.request("desktopExtension/list", params.cwd ? { cwd: params.cwd } : {});
					if (!checkList.Check(snapshot)) throw new Error("Malformed desktop extension list.");
					const entry = snapshot.extensions.find((entry) => entry.owner === params.owner);
					if (!entry || entry.source !== params.source)
						throw new Error("The extension source changed. Review its source again.");
					const { response } = await dialog.showMessageBox(window, {
						type: "warning",
						title: "Trust native desktop code?",
						message: `Trust ${entry.name}?`,
						detail: `Source: ${entry.source}\nEntry kind: native frontend\n\nThis code shares the app renderer. It can inspect conversations and change the app UI. It is not sandboxed from the app. Session/plugin trust does not grant this permission.\n\nTrusting development reloads also approves future edits at this source.`,
						buttons: ["Trust this revision", "Trust development reloads", "Cancel"],
						defaultId: 2,
						cancelId: 2,
					});
					if (response === 2) break;
					result = await server.request("desktopExtension/set", { ...params, dev: response === 1 });
				} else result = await server.request("desktopExtension/set", params);
				break;
			}
			case "host/desktopExtension/reload":
				result = await server.request("desktopExtension/reload", {});
				break;
			case "host/desktopExtension/diagnostic": {
				const params = request.params as HostParams<"host/desktopExtension/diagnostic">;
				result = await server.request("desktopExtension/diagnostic", {
					...params,
					diagnostic: { ...params.diagnostic, windowId },
				});
				break;
			}
			case "host/desktopExtension/release": {
				const { owner, revision, lease } = request.params as HostParams<"host/desktopExtension/release">;
				artifacts.release(windowId, owner, revision, lease);
				break;
			}
		}
		return { id: request.id, result };
	} catch (error) {
		return {
			id: request.id,
			error: { code: "internal", message: error instanceof Error ? error.message : String(error) },
		};
	}
}
