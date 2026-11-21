/** Main's native-consent gate and window leases over the app server's immutable artifacts. */
import { DesktopExtensionRequests, type ParamsOf } from "@knightcode/app-server-protocol";
import { type BrowserWindow, dialog } from "electron";
import { Compile } from "typebox/compile";
import { DesktopExtensionHostMethods } from "../shared/desktop-extensions.ts";
import type { HostRequest, HostResponse, HostParams } from "../shared/host-protocol.ts";
import type { ExtensionArtifacts } from "./extension-artifacts.ts";
import type { ServerConnection } from "./server.ts";
import type { ExtensionProviderPreferences } from "./extension-preferences.ts";
import type { DesktopExtensionWindows } from "./desktop-extension-runtime.ts";

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
		runtime: DesktopExtensionWindows;
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
			case "host/desktopExtension/window/connect":
				if (safeMode) throw new Error("External extensions are disabled in safe mode.");
				await services.runtime.connect(windowId);
				break;
			case "host/desktopExtension/call":
				result = safeMode
					? { status: "disconnected" }
					: await services.runtime.call(
							windowId,
							request.id,
							request.params as HostParams<"host/desktopExtension/call">,
						);
				break;
			case "host/desktopExtension/cancel":
				await services.runtime.cancel(windowId, request.params as HostParams<"host/desktopExtension/cancel">);
				break;
			case "host/desktopExtension/reconcile":
			case "host/desktopExtension/ack":
			case "host/desktopExtension/fail":
			case "host/desktopExtension/subscribe":
			case "host/desktopExtension/unsubscribe":
				if (safeMode) throw new Error("External extensions are disabled in safe mode.");
				result = await services.runtime.forward(windowId, request.host.slice("host/".length), request.params as object);
				break;
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
				const artifact = services.runtime.artifact(windowId, params.owner, params.revision);
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
					const review = { ...(params.cwd ? { cwd: params.cwd } : {}), review: params.owner };
					const snapshot = await server.request("desktopExtension/list", review);
					if (!checkList.Check(snapshot)) throw new Error("Malformed desktop extension list.");
					const entry = snapshot.extensions.find((entry) => entry.owner === params.owner);
					if (!entry || entry.source !== params.source)
						throw new Error("The extension source changed. Review its source again.");
					const kinds = entry.kinds;
					if (!kinds?.length) throw new Error("The extension has no valid native entry kinds to review.");
					const revision = entry.revision;
					if (!revision) throw new Error(entry.error ?? "The extension has no validated revision to review.");
					const risks = [
						...(kinds.includes("frontend")
							? [
									"Frontend code shares the app renderer. It can inspect conversations and change the app UI. It is not sandboxed from the app.",
								]
							: []),
						...(kinds.includes("backend")
							? [
									"Backend code runs with the app server's OS permissions. It can read and write files, access credentials and start processes. It is not sandboxed.",
								]
							: []),
					].join("\n\n");
					const { response } = await dialog.showMessageBox(window, {
						type: "warning",
						title: "Trust native desktop code?",
						message: `Trust ${entry.name}?`,
						detail: `Source: ${entry.source}\nRevision: ${revision}\nEntry kinds: ${kinds.map((kind) => `native ${kind}`).join(", ")}\n\n${risks}\n\nSession/plugin trust does not grant these permissions.\n\nTrusting development reloads also approves future edits at this source, but not new native entry kinds.`,
						buttons: ["Trust this revision", "Trust development reloads", "Cancel"],
						defaultId: 2,
						cancelId: 2,
					});
					if (response === 2) break;
					const current = await server.request("desktopExtension/list", review);
					if (!checkList.Check(current)) throw new Error("Malformed desktop extension list.");
					const latest = current.extensions.find((item) => item.owner === params.owner);
					if (latest?.revision !== revision || latest.source !== entry.source)
						throw new Error("The extension changed while its confirmation was open. Review it again.");
					result = await server.request("desktopExtension/set", {
						...params,
						kinds,
						revision,
						dev: response === 1,
					});
				} else result = await server.request("desktopExtension/set", params);
				break;
			}
			case "host/desktopExtension/reload":
				result = await server.request("desktopExtension/reload", {});
				break;
			case "host/desktopExtension/preview/set": {
				const { enabled } = request.params as HostParams<"host/desktopExtension/preview/set">;
				// Turning external code on is a native decision; the renderer request alone is not consent.
				if (enabled) {
					const { response } = await dialog.showMessageBox(window, {
						type: "warning",
						title: "Turn on native desktop extensions?",
						message: "Turn on native desktop extensions (preview)?",
						detail:
							"Extensions you approved will run. Frontend code shares the app renderer; backend code runs with the app server's OS permissions. They are not sandboxed. Each extension still needs its own native consent.",
						buttons: ["Turn on", "Cancel"],
						defaultId: 1,
						cancelId: 1,
					});
					if (response !== 0) break;
				}
				result = await server.request("desktopExtension/preview/set", { enabled });
				break;
			}
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
