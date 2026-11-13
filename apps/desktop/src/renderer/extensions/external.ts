/** Shared-runtime ESM loading through script elements; no eval, inline imports or second React instance. */
import * as SDK from "@knightcodeai/cli/desktop";
import type { DesktopArtifact, DesktopExtensionDiagnostic } from "@knightcode/app-server-protocol";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as JSX from "react/jsx-runtime";
import * as Radix from "radix-ui";
import * as Diffs from "@pierre/diffs";
import * as Trees from "@pierre/trees";
import * as Typebox from "typebox";
import type { Static } from "typebox";
import { client } from "../client.ts";
import type { DesktopProviderPreferences } from "../../shared/desktop-extensions.ts";
import { FrontendExtensions } from "./loader.ts";
import type { ExtensionRegistry } from "./registry.ts";
import { artifactUrl, loadRevisionStyles } from "./styles.ts";

type Artifact = Static<typeof DesktopArtifact>;
const runtime: Record<string, object> = {
	"@knightcodeai/cli/desktop": SDK,
	react: React,
	"react-dom": ReactDOM,
	"react/jsx-runtime": JSX,
	"radix-ui": Radix,
	"@pierre/diffs": Diffs,
	"@pierre/trees": Trees,
	typebox: Typebox,
};
const callbacks = new Map<string, (extension: unknown) => void>();
const listeners = new Set<() => void>();
let failures: ReadonlyMap<string, string> = new Map();
let providers: DesktopProviderPreferences = { app: {}, window: {} };

export const externalState = {
	subscribe: (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
	getFailures: () => failures,
	getProviders: () => providers,
};

export function reportExternal(
	owner: string,
	revision: string,
	phase: DesktopExtensionDiagnostic["phase"],
	message: string,
): void {
	const next = new Map(failures);
	if (phase === "active") next.delete(owner);
	else next.set(owner, message);
	failures = next;
	for (const listener of listeners) listener();
	void client
		.host("host/desktopExtension/diagnostic", {
			owner,
			diagnostic: { revision, phase, message: message.slice(0, 4096) },
		})
		.catch(() => {});
}

declare global {
	var __knightcodeDesktopRuntime: Record<string, object> | undefined;
	var __knightcodeDesktopLoaded: ((activation: string | null, extension: unknown) => void) | undefined;
}

/** Connect only after main's server-ready event; built-ins remain synchronous and independent. */
export function startExternalExtensions(registry: ExtensionRegistry): () => void {
	globalThis.__knightcodeDesktopRuntime = runtime;
	globalThis.__knightcodeDesktopLoaded = (activation, extension) => {
		if (activation) callbacks.get(activation)?.(extension);
	};
	const loader = new FrontendExtensions(registry, prepareArtifact, reportExternal, ReactDOM.flushSync);
	let closed = false;
	let refreshId = 0;
	const refresh = async (reason: "changed" | "reload" = "changed") => {
		const id = ++refreshId;
		try {
			const next = await client.host("host/desktopExtension/list", {
				runtime: Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, Object.keys(value)])),
			});
			if (closed || id !== refreshId) return;
			providers = next.providers;
			failures = new Map(
				[...failures].filter(([owner]) => next.extensions.some((entry) => entry.owner === owner && entry.enabled)),
			);
			for (const listener of listeners) listener();
			await loader.update(next, reason);
		} catch (error) {
			if (!closed && id === refreshId)
				reportExternal("host", "unknown", "load", error instanceof Error ? error.message : String(error));
		}
	};
	const offEvent = client.onHostEvent((event) => {
		if (event.event === "desktopExtension/providers") {
			providers = event.providers;
			for (const listener of listeners) listener();
			return;
		}
		if (event.event !== "server/state") return;
		if (event.state === "ready") void refresh();
		else {
			refreshId++;
			loader.dispose();
		}
	});
	const offNotification = client.onNotification((event) => {
		if (event.method === "desktopExtension/changed") void refresh(event.params.reload ? "reload" : "changed");
	});
	return () => {
		closed = true;
		refreshId++;
		offEvent();
		offNotification();
		loader.dispose();
		callbacks.clear();
		globalThis.__knightcodeDesktopLoaded = undefined;
		globalThis.__knightcodeDesktopRuntime = undefined;
	};
}

async function prepareArtifact(
	artifact: Artifact,
	signal: AbortSignal,
): Promise<{ extension: SDK.experimental_DesktopExtension; dispose(): void }> {
	const release = await loadRevisionStyles(artifact, signal, async () => {
		const lease = crypto.randomUUID();
		await client.host("host/desktopExtension/acquire", { owner: artifact.owner, revision: artifact.revision, lease });
		return () => {
			void client
				.host("host/desktopExtension/release", { owner: artifact.owner, revision: artifact.revision, lease })
				.catch(() => {});
		};
	});
	const activation = crypto.randomUUID();
	const script = document.createElement("script");
	script.type = "module";
	script.crossOrigin = "anonymous";
	script.src = `${artifactUrl(artifact, artifact.frontend)}?activation=${activation}`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort = () => {};
	let moduleError = (_event: ErrorEvent) => {};
	try {
		const extension = await new Promise<SDK.experimental_DesktopExtension>((resolve, reject) => {
			callbacks.set(activation, (value) => {
				// Executable module export is a trust boundary, not a typed extension callback result.
				if (
					!value ||
					typeof value !== "object" ||
					!("apiVersion" in value) ||
					typeof value.apiVersion !== "number" ||
					!("experimental_setup" in value) ||
					typeof value.experimental_setup !== "function"
				) {
					reject(new Error("Default export must be defineDesktopExtension(...)."));
					return;
				}
				resolve(value as SDK.experimental_DesktopExtension);
			});
			moduleError = (event) => {
				if (event.filename.startsWith(artifactUrl(artifact, "")))
					reject(new Error(`Extension module evaluation failed: ${event.message}`));
			};
			window.addEventListener("error", moduleError);
			script.onload = () => reject(new Error("Extension module finished without a valid desktop declaration."));
			script.onerror = () =>
				reject(
					new Error(
						`Failed to import ${artifact.owner} revision ${artifact.revision}. Check top-level imports and the default export.`,
					),
				);
			abort = () => reject(new Error("Extension activation cancelled."));
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) {
				abort();
				return;
			}
			timer = setTimeout(() => reject(new Error("Extension module readiness timed out.")), 10_000);
			document.head.append(script);
		});
		return {
			extension,
			dispose: () => {
				script.remove();
				release();
			},
		};
	} catch (error) {
		script.remove();
		release();
		throw error;
	} finally {
		clearTimeout(timer);
		callbacks.delete(activation);
		signal.removeEventListener("abort", abort);
		window.removeEventListener("error", moduleError);
	}
}
