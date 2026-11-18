/** Shared-runtime ESM loading through script elements; no eval, inline imports or second React instance. */
import * as SDK from "@knightcodeai/cli/desktop";
import type {
	DesktopActivationBinding,
	DesktopArtifact,
	DesktopExtensionDiagnostic,
	DesktopExtensionPhase,
} from "@knightcode/app-server-protocol";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as JSX from "react/jsx-runtime";
import * as Radix from "radix-ui";
import * as Diffs from "@pierre/diffs";
import * as Trees from "@pierre/trees";
import * as Typebox from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { client } from "../client.ts";
import { DesktopProviderPreferences } from "../../shared/desktop-extensions.ts";
import { startupLayout } from "./startup.ts";
import { FrontendExtensions } from "./loader.ts";
import { FrontendActivation } from "./activation.ts";
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
let activeLoader: FrontendExtensions | undefined;
const listeners = new Set<() => void>();
let failures: ReadonlyMap<string, string> = new Map();
const windowKey = `knightcode.desktop.providers.window.${window.knightcode?.windowId ?? 0}`;
const providerCheck = Compile(DesktopProviderPreferences);
let providers: DesktopProviderPreferences = { app: startupLayout.getSnapshot().providers, window: {} };
try {
	const raw = window.sessionStorage?.getItem(windowKey);
	if (raw && !window.knightcode?.safeMode) {
		const value: unknown = raw.length <= 65536 ? JSON.parse(raw) : null;
		if (providerCheck.Check(value)) providers = { app: providers.app, window: value.window };
	}
} catch {
	/* The main-owned choices will arrive with the server connection. */
}

function rememberProviders(): void {
	if (window.knightcode?.safeMode) return;
	try {
		window.sessionStorage?.setItem(windowKey, JSON.stringify(providers));
	} catch {
		/* Optional startup hint. */
	}
	startupLayout.update(providers.app, startupLayout.getSnapshot().hidden);
}

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
	binding?: DesktopActivationBinding,
): void {
	if (binding && phase === "render")
		queueMicrotask(() => {
			activeLoader?.revoke(owner, binding);
			void client.host("host/desktopExtension/fail", { binding, message: message.slice(0, 4096) }).catch(() => {});
		});
	const next = new Map(failures);
	if (phase === "active") next.delete(owner);
	else {
		next.set(owner, message);
		startupLayout.invalidateOwner(owner);
	}
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
	var __knightcodeDesktopScopedRuntime: Record<string, typeof SDK> | undefined;
	var __knightcodeDesktopLoaded: ((activation: string | null, extension: unknown) => void) | undefined;
}

/** Connect only after main's server-ready event; built-ins remain synchronous and independent. */
export function startExternalExtensions(registry: ExtensionRegistry): () => void {
	globalThis.__knightcodeDesktopRuntime = runtime;
	globalThis.__knightcodeDesktopLoaded = (activation, extension) => {
		if (activation) callbacks.get(activation)?.(extension);
	};
	const host = globalThis.__knightcodeDesktop;
	if (!host) throw new Error("Desktop window host is unavailable.");
	const retired = new FrontendActivation(
		{ owner: "retired", revision: "", epoch: "", window: "", mount: "" },
		host,
		() => {},
	);
	retired.dispose();
	const scopes: Record<string, typeof SDK> = { retired: retired.sdk };
	globalThis.__knightcodeDesktopScopedRuntime = scopes;
	const loader = new FrontendExtensions(
		registry,
		(artifact, signal, activation) => prepareArtifact(artifact, signal, activation, scopes),
		reportExternal,
		ReactDOM.flushSync,
	);
	activeLoader = loader;
	const offRegistry = registry.subscribe(() => {
		if (window.knightcode?.safeMode) return;
		const hidden = registry
			.hiddenNavigation()
			.flatMap((entry) => (entry.revision ? [{ ...entry, revision: entry.revision }] : []));
		const liveOwners = new Set(
			registry
				.getSnapshot()
				.filter((entry) => entry.revision)
				.map((entry) => entry.owner),
		);
		const pending = startupLayout.getSnapshot().hidden.filter((entry) => !liveOwners.has(entry.owner));
		startupLayout.update(providers.app, [...pending, ...hidden]);
	});
	let closed = false;
	let refreshId = 0;
	let generation = 0;
	let connection: Promise<unknown> | undefined;
	const refresh = async () => {
		const id = ++refreshId;
		const session = generation;
		try {
			const next = await client.host("host/desktopExtension/list", {
				runtime: Object.fromEntries(Object.entries(runtime).map(([name, value]) => [name, Object.keys(value)])),
			});
			if (closed || id !== refreshId || session !== generation) return;
			providers = next.providers;
			startupLayout.reconcile(next.providers.app, next.extensions);
			rememberProviders();
			failures = new Map(
				[...failures].filter(([owner]) => next.extensions.some((entry) => entry.owner === owner && entry.enabled)),
			);
			for (const entry of next.extensions)
				if (entry.error) reportExternal(entry.owner, entry.revision ?? "unknown", "load", entry.error);
			for (const listener of listeners) listener();
			if (next.safeMode) {
				loader.dispose();
				return;
			}
			connection ??= client.host("host/desktopExtension/window/connect", {});
			await connection;
			if (!closed && id === refreshId && session === generation)
				await client.host("host/desktopExtension/reconcile", {});
		} catch (error) {
			if (!closed && id === refreshId && session === generation) {
				connection = undefined;
				reportExternal("host", "unknown", "load", error instanceof Error ? error.message : String(error));
			}
		}
	};
	const phase = async (event: DesktopExtensionPhase) => {
		const session = generation;
		const { binding } = event;
		try {
			switch (event.phase) {
				case "prepare":
					if (!event.artifact || !event.contracts) throw new Error("Prepared frontend metadata is incomplete.");
					await loader.prepare({ binding, artifact: event.artifact, contracts: event.contracts });
					break;
				case "quiesce":
					await loader.quiesce(binding);
					break;
				case "publish":
					loader.publish(binding);
					break;
				case "resume":
					loader.resume(binding);
					break;
				case "discard":
					loader.discard(binding);
					return;
				case "revoke":
					loader.revoke(binding.owner);
					return;
				case "ready":
					loader.ready(binding);
					return;
			}
			if (!closed && session === generation) await client.host("host/desktopExtension/ack", { id: event.id, binding });
		} catch (error) {
			if (closed || session !== generation) return;
			const message = (error instanceof Error ? error.message : String(error)) || "Frontend activation failed.";
			reportExternal(binding.owner, binding.revision, "load", message);
			if (event.phase === "ready") {
				loader.revoke(binding.owner, binding);
				await client.host("host/desktopExtension/fail", { binding, message: message.slice(0, 4096) }).catch(() => {});
			} else
				await client
					.host("host/desktopExtension/ack", { id: event.id, binding, error: message.slice(0, 4096) })
					.catch(() => {});
		}
	};
	const offEvent = client.onHostEvent((event) => {
		if (event.event === "desktopExtension/phase") {
			if (!closed) void phase(event.phase);
			return;
		}
		if (event.event === "desktopExtension/providers") {
			providers = event.providers;
			rememberProviders();
			for (const listener of listeners) listener();
			return;
		}
		if (event.event !== "server/state") return;
		if (event.state === "ready") void refresh();
		else {
			refreshId++;
			generation++;
			connection = undefined;
			loader.dispose();
		}
	});
	const offNotification = client.onNotification((event) => {
		if (event.method === "desktopExtension/changed") void refresh();
	});
	return () => {
		closed = true;
		offRegistry();
		refreshId++;
		generation++;
		offEvent();
		offNotification();
		loader.dispose();
		if (activeLoader === loader) activeLoader = undefined;
		callbacks.clear();
		if (globalThis.__knightcodeDesktopScopedRuntime === scopes) globalThis.__knightcodeDesktopScopedRuntime = undefined;
		globalThis.__knightcodeDesktopLoaded = undefined;
		globalThis.__knightcodeDesktopRuntime = undefined;
	};
}
async function prepareArtifact(
	artifact: Artifact,
	signal: AbortSignal,
	context: FrontendActivation,
	scopes: Record<string, typeof SDK>,
): Promise<{ extension: SDK.experimental_DesktopExtension; dispose(): void }> {
	const activation = crypto.randomUUID();
	scopes[activation] = context.sdk;
	const releaseModule = () => {
		void client
			.host("host/desktopExtension/release", { owner: artifact.owner, revision: artifact.revision, lease: activation })
			.catch(() => {});
	};
	let release: () => void;
	try {
		await client.host("host/desktopExtension/acquire", {
			owner: artifact.owner,
			revision: artifact.revision,
			lease: activation,
		});
		release = await loadRevisionStyles(artifact, signal, async () => {
			const lease = crypto.randomUUID();
			await client.host("host/desktopExtension/acquire", { owner: artifact.owner, revision: artifact.revision, lease });
			return () => {
				void client
					.host("host/desktopExtension/release", { owner: artifact.owner, revision: artifact.revision, lease })
					.catch(() => {});
			};
		});
	} catch (error) {
		delete scopes[activation];
		releaseModule();
		throw error;
	}
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
			// Module load can finish before a top-level await resolves; the callback or readiness deadline settles it.
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
				delete scopes[activation];
				script.remove();
				releaseModule();
				release();
			},
		};
	} catch (error) {
		delete scopes[activation];
		script.remove();
		releaseModule();
		release();
		throw error;
	} finally {
		clearTimeout(timer);
		callbacks.delete(activation);
		signal.removeEventListener("abort", abort);
		window.removeEventListener("error", moduleError);
	}
}
