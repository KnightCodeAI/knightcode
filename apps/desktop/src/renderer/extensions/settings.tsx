/** Host-owned native extension management and recovery, never provided by an extension. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { experimental_CommandContext } from "@knightcodeai/cli/desktop";
import type { ResultOf } from "@knightcode/app-server-protocol";
import { client } from "../client.ts";
import { Button } from "../components/button.tsx";
import { Switch } from "../components/switch.tsx";
import { errorText, navigate, toast } from "../store.ts";
import { externalState } from "./external.ts";
import { desktopExtensions } from "./runtime.ts";
import { STRUCTURAL_BUILTINS, type ProviderSurface } from "./providers.ts";

export function NativeExtensionsSettings({ cwd }: { cwd?: string }) {
	const [list, setList] = useState<ResultOf<"desktopExtension/list">>();
	const [busy, setBusy] = useState(false);
	const failures = useSyncExternalStore(externalState.subscribe, externalState.getFailures);
	const preferences = useSyncExternalStore(externalState.subscribe, externalState.getProviders);
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	const latest = useRef(0);
	const load = useCallback(() => {
		const request = ++latest.current;
		void client
			.host("host/desktopExtension/list", cwd ? { cwd } : {})
			.then((next) => {
				if (request === latest.current) setList(next);
			})
			.catch((error: unknown) => toast(errorText(error), "error"));
		return () => {
			latest.current++;
		};
	}, [cwd]);
	useEffect(load, [load]);
	useEffect(
		() =>
			client.onNotification((event) => {
				if (event.method === "desktopExtension/changed") load();
			}),
		[load],
	);
	const run = (work: Promise<unknown>) => {
		setBusy(true);
		void work
			.then(() => {
				load();
			})
			.catch((error: unknown) => toast(errorText(error), "error"))
			.finally(() => setBusy(false));
	};
	if (
		!list ||
		(!list.safeMode &&
			list.extensions.length === 0 &&
			Object.keys(preferences.app).length === 0 &&
			Object.keys(preferences.window).length === 0)
	)
		return null;

	return (
		<section aria-label="Native desktop extensions" className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-4">
				<h2 className="text-base font-medium">Native desktop extensions (preview)</h2>
				<Button
					variant="soft"
					toolbar
					disabled={busy}
					onClick={() => run(client.host("host/desktopExtension/reload", {}))}
				>
					Reload extensions
				</Button>
			</div>
			{list.safeMode ? (
				<p role="status" className="text-sm text-secondary">
					Safe mode: no external frontend code or backend code is loaded. Restart normally to use extensions.
				</p>
			) : null}
			<p className="text-xs text-secondary">
				Native frontend code shares the app renderer; backend code runs with the app server's OS permissions. Session
				extensions and Claude/Grok plugins do not grant native trust. Review each source before approving it.
			</p>
			<label className="flex items-center justify-between gap-4 text-sm">
				<span className="flex flex-col gap-0.5">
					<span className="font-medium">Run native desktop extensions</span>
					<span className="text-xs text-secondary">
						{list.preview
							? "Approved extensions run in every window."
							: "Off: no extension frontend or backend code runs, even if approved."}
					</span>
				</span>
				<Switch
					label="Run native desktop extensions"
					checked={list.preview}
					disabled={busy || list.safeMode}
					onChange={(enabled) => run(client.host("host/desktopExtension/preview/set", { enabled }))}
				/>
			</label>
			{list.extensions.map((entry) => (
				<div key={entry.owner} className="rounded-2xl border border-line bg-section p-4" data-extension={entry.owner}>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h3 className="text-sm font-medium">{entry.name}</h3>
						<div className="flex gap-2">
							<Button
								variant="soft"
								toolbar
								disabled={busy}
								onClick={() =>
									run(
										client.host("host/desktopExtension/set", {
											owner: entry.owner,
											source: entry.source,
											...(cwd ? { cwd } : {}),
											approve: true,
											enabled: true,
										}),
									)
								}
							>
								{entry.approved
									? "Review trust"
									: entry.kinds?.includes("backend")
										? "Trust native code"
										: "Trust frontend"}
							</Button>
							{entry.approved ? (
								<Button
									variant="soft"
									toolbar
									disabled={busy}
									onClick={() =>
										run(
											client.host("host/desktopExtension/set", {
												owner: entry.owner,
												...(cwd ? { cwd } : {}),
												enabled: !entry.enabled,
											}),
										)
									}
								>
									{entry.enabled ? "Disable" : "Enable"}
								</Button>
							) : null}
							{entry.approved ? (
								<Button
									variant="soft"
									toolbar
									disabled={busy}
									onClick={() =>
										run(
											client.host("host/desktopExtension/set", {
												owner: entry.owner,
												...(cwd ? { cwd } : {}),
												revoke: true,
											}),
										)
									}
								>
									Revoke trust
								</Button>
							) : null}
						</div>
					</div>
					<p className="selectable mt-2 text-xs break-all text-secondary">{entry.source}</p>
					<p className="mt-1 text-xs text-secondary">
						{entry.approved ? (entry.enabled ? "Enabled" : "Disabled") : "Native consent required"}
						{entry.dev ? " · Development reloads approved" : ""}
						{entry.revision ? ` · ${entry.revision.slice(0, 12)}` : ""}
					</p>
					{entry.error || failures.get(entry.owner) ? (
						<p role="alert" className="mt-2 text-xs text-danger-text">
							{entry.error ?? failures.get(entry.owner)}
						</p>
					) : null}
					{entry.diagnostics
						.filter((diagnostic) => diagnostic.message)
						.map((diagnostic) => (
							<p key={diagnostic.windowId} className="mt-1 text-xs text-secondary">
								Window {diagnostic.windowId} · {diagnostic.phase}: {diagnostic.message}
							</p>
						))}
				</div>
			))}
			{Object.entries(STRUCTURAL_BUILTINS).map(([surface, builtin]) => {
				const available = desktopExtensions
					.getSnapshot()
					.filter(
						(entry) =>
							entry.kind === "provider" &&
							entry.contribution.surface === surface &&
							(!entry.activation || entry.activation.admitted()),
					);
				const preferred = preferences.app[surface] ?? builtin;
				const windowChoice = preferences.window[surface] ?? "";
				const label =
					surface === "feedback"
						? "Feedback"
						: surface === "threadList"
							? "Thread list"
							: surface === "titleBar"
								? "Title bar"
								: surface[0]!.toUpperCase() + surface.slice(1);
				return (
					<div key={surface} className="flex flex-col gap-3">
						<label className="flex flex-wrap items-center justify-between gap-3 text-sm">
							{label} provider
							<select
								aria-label={`${label} provider`}
								className="kc-input max-w-80 border-line-strong"
								value={preferred}
								onChange={(event) =>
									run(
										client.host("host/desktopExtension/provider/set", {
											surface: surface as ProviderSurface,
											scope: "app",
											provider: event.target.value,
										}),
									)
								}
							>
								{available.map((entry) => (
									<option key={entry.id} value={entry.id}>
										{entry.id}
									</option>
								))}
								{!available.some((entry) => entry.id === preferred) ? (
									<option value={preferred}>{preferred} (unavailable; using built-in)</option>
								) : null}
							</select>
						</label>
						<label className="flex flex-wrap items-center justify-between gap-3 text-sm">
							{label} provider for this window
							<select
								aria-label={`${label} provider for this window`}
								className="kc-input max-w-80 border-line-strong"
								value={windowChoice}
								onChange={(event) =>
									run(
										client.host("host/desktopExtension/provider/set", {
											surface: surface as ProviderSurface,
											scope: "window",
											provider: event.target.value,
										}),
									)
								}
							>
								<option value="">Use app default</option>
								{available.map((entry) => (
									<option key={entry.id} value={entry.id}>
										{entry.id}
									</option>
								))}
								{windowChoice && !available.some((entry) => entry.id === windowChoice) ? (
									<option value={windowChoice}>{windowChoice} (unavailable)</option>
								) : null}
							</select>
						</label>
					</div>
				);
			})}
		</section>
	);
}

/** Fallback notices remain outside the replaceable feedback surface and keep recovery reachable. */
export function NativeExtensionRecovery({ context }: { context: experimental_CommandContext }) {
	const failures = useSyncExternalStore(externalState.subscribe, externalState.getFailures, externalState.getFailures);
	const preferences = useSyncExternalStore(
		externalState.subscribe,
		externalState.getProviders,
		externalState.getProviders,
	);
	const dismissed = useSyncExternalStore(dismissal.subscribe, dismissal.get, dismissal.get);
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot, desktopExtensions.getSnapshot);
	const chosen = Object.entries(STRUCTURAL_BUILTINS).flatMap(([surface, builtin]) => {
		const preferred = preferences.window[surface] ?? preferences.app[surface];
		return preferred &&
			preferred !== builtin &&
			(desktopExtensions.resolveProvider(surface as ProviderSurface, builtin, preferred, context)?.id !== preferred ||
				failures.has(preferred.split("/")[0]!))
			? [{ surface: surface as ProviderSurface, builtin, preferred }]
			: [];
	})[0];
	const preferred = chosen?.preferred;
	const unavailable = !!chosen;
	if (failures.size === 0 && !chosen) return null;
	// Dismissal covers exactly what was showing; a new failure or provider fallback shows the notice again.
	const shown = noticeKey(failures, chosen?.surface);
	lastShown = shown;
	if (dismissed === shown) return null;
	return (
		<aside
			role="alert"
			aria-label="Desktop extension recovery"
			// Below the title bar and the thread header row (56px), so header actions stay clickable.
			className="fixed top-28 right-4 z-50 flex max-w-sm flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm shadow-lg"
		>
			<p>
				{unavailable
					? `The selected ${chosen!.surface} provider is unavailable. Using the built-in.`
					: "A desktop extension failed. Working UI is retained where possible; failed views use the built-in."}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button variant="soft" toolbar onClick={() => navigate({ kind: "settings", page: "extensions" })}>
					Manage extensions
				</Button>
				<Button
					variant="soft"
					toolbar
					onClick={() => {
						void client
							.host("host/desktopExtension/provider/set", {
								surface: chosen?.surface ?? "feedback",
								scope: chosen && preferences.window[chosen.surface] ? "window" : "app",
								provider: chosen?.builtin ?? "builtin.feedback/toasts",
							})
							.catch((error: unknown) => toast(errorText(error), "error"));
					}}
				>
					Switch back
				</Button>
				{preferred && preferred !== "builtin.feedback/toasts" ? (
					<Button
						variant="soft"
						toolbar
						onClick={() => {
							void client
								.host("host/desktopExtension/set", { owner: preferred.split("/")[0]!, enabled: false })
								.catch((error: unknown) => toast(errorText(error), "error"));
						}}
					>
						Disable extension
					</Button>
				) : null}
				<Button variant="ghost" color="secondary" toolbar onClick={dismissRecovery}>
					Dismiss
				</Button>
			</div>
		</aside>
	);
}

// What the notice last drew and what the user dismissed; both window-local, never persisted.
let lastShown: string | undefined;
let dismissedKey: string | undefined;
const dismissalListeners = new Set<() => void>();
const dismissal = {
	subscribe: (listener: () => void) => {
		dismissalListeners.add(listener);
		return () => {
			dismissalListeners.delete(listener);
		};
	},
	get: () => dismissedKey,
};

/** Hide the recovery notice until the set of failures or the unavailable provider changes. */
export function dismissRecovery(): void {
	dismissedKey = lastShown;
	for (const listener of dismissalListeners) listener();
}

function noticeKey(failures: ReadonlyMap<string, string>, surface: string | undefined): string {
	return JSON.stringify([surface ?? null, [...failures].toSorted(([a], [b]) => a.localeCompare(b))]);
}
