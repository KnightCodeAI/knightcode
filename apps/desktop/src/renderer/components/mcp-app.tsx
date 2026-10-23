/**
 * An MCP App in the transcript (desktop-shell.md section 12.2): the tool's `ui://` resource, read through
 * `mcp/app/readResource`, served by main on its own `kc-mcp-app://` origin, in a sandboxed frame with no referrer and
 * no permissions, bridged to the app server (mcp-app-bridge.ts). Inline it is 48-720px high, as the app asks; full
 * screen it is a side panel tab.
 *
 * The frame is made in an effect, not rendered by React: React removes DOM without waiting, and the app must hear
 * `ui/resource-teardown` before its frame goes. On unmount the frame moves (`moveBefore` keeps its state) to a hidden
 * holder until the app answers or a second passes, then main releases its document.
 */

import type { McpApp } from "@knightcode/app-server-protocol";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ToolItem } from "../activity.ts";
import { client, RequestError } from "../client.ts";
import { type BridgeHost, type DisplayMode, McpAppBridge, MIN_HEIGHT } from "../mcp-app-bridge.ts";
import { closeAppTab, openAppTab, send, useStore } from "../store.ts";
import { Button, IconButton } from "./button.tsx";
import { Dialog, DialogActions } from "./dialog.tsx";
import { Maximize } from "./icons.tsx";

const APP_MIME = "text/html;profile=mcp-app";

export type AppItem = ToolItem & { mcpApp: McpApp };

interface Loaded {
	id: string;
	url: string;
	csp: Record<string, unknown>;
	prefersBorder: boolean;
}

/** The app's document: the first content of the app MIME type, its text or base64 blob, with its `_meta.ui`. */
async function loadApp(threadId: string, app: McpApp): Promise<Loaded> {
	const { contents } = await client.request("mcp/app/readResource", { threadId, server: app.server, uri: app.resourceUri });
	const content = contents.find(
		(c): c is Record<string, unknown> =>
			typeof c === "object" && c !== null && String((c as { mimeType?: unknown }).mimeType ?? "").startsWith(APP_MIME),
	);
	if (!content) throw new Error("The server sent no app for this tool");
	const html =
		typeof content.text === "string"
			? content.text
			: typeof content.blob === "string"
				? new TextDecoder().decode(Uint8Array.from(atob(content.blob), (ch) => ch.charCodeAt(0)))
				: undefined;
	if (html === undefined) throw new Error("The app's resource has no document");
	const ui = ((content._meta as { ui?: Record<string, unknown> } | undefined)?.ui ?? {}) as Record<string, unknown>;
	const declared = (typeof ui.csp === "object" && ui.csp !== null ? ui.csp : {}) as Record<string, unknown>;
	const csp = Object.fromEntries(
		["connectDomains", "resourceDomains", "frameDomains", "baseUriDomains"].flatMap((key) =>
			declared[key] === undefined ? [] : [[key, declared[key]]],
		),
	);
	try {
		const served = await client.host("host/mcpApp/serve", { html, csp });
		return { ...served, csp, prefersBorder: ui.prefersBorder !== false };
	} catch (error) {
		throw error instanceof RequestError && error.code === "invalidParams"
			? new Error(`This app declared an invalid content policy: ${error.message}`)
			: error;
	}
}

let holder: HTMLDivElement | undefined;
/** Where a leaving frame waits for its teardown, out of sight. */
function teardownHolder(): HTMLDivElement {
	if (!holder?.isConnected) {
		holder = document.createElement("div");
		holder.setAttribute("aria-hidden", "true");
		holder.style.cssText = "position: fixed; width: 0; height: 0; overflow: hidden; visibility: hidden;";
		document.body.appendChild(holder);
	}
	return holder;
}

type Ask = { kind: "tool"; server: string; tool: string } | { kind: "message"; text: string };

/** Codex's confirmations: an app's follow-up prompt ("Send follow-up?"), and a call that may change things. */
function AskDialog({ ask, onAnswer }: { ask: Ask; onAnswer: (yes: boolean) => void }) {
	return (
		<Dialog
			title={ask.kind === "message" ? "Send follow-up?" : `Run ${ask.tool}?`}
			description={
				ask.kind === "message"
					? "An app wants to send this prompt"
					: `The ${ask.server} app wants to run this tool, which may change things.`
			}
			onClose={() => onAnswer(false)}
		>
			{ask.kind === "message" ? (
				<div className="mt-3 flex flex-col gap-1.5">
					<span className="text-sm text-tertiary">Prompt</span>
					<p className="max-h-60 overflow-auto rounded-lg bg-soft-alt px-3 py-2 text-base whitespace-pre-wrap text-ink">
						{ask.text}
					</p>
				</div>
			) : null}
			<DialogActions>
				<Button color="secondary" size="lg" squircle className="px-4" onClick={() => onAnswer(false)}>
					Cancel
				</Button>
				<Button variant="solid" size="lg" squircle className="px-4" onClick={() => onAnswer(true)}>
					{ask.kind === "message" ? "Send" : "Run"}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

export function McpAppView({
	threadId,
	item,
	mode = "inline",
}: {
	threadId: string;
	item: AppItem;
	mode?: DisplayMode;
}) {
	const box = useRef<HTMLDivElement>(null);
	const bridge = useRef<McpAppBridge | undefined>(undefined);
	const latest = useRef(item);
	latest.current = item;
	const theme = useStore((s) => s.resolvedTheme);
	const themeRef = useRef(theme);
	themeRef.current = theme;
	const [loaded, setLoaded] = useState<Loaded>();
	const [error, setError] = useState<string>();
	const [height, setHeight] = useState(160);
	const [ask, setAsk] = useState<{ ask: Ask; answer: (yes: boolean) => void }>();
	const [version, setVersion] = useState("");
	const versionRef = useRef(version);
	versionRef.current = version;
	useEffect(() => void client.host("host/app/info", {}).then((info) => setVersion(info.appVersion), () => {}), []);

	useEffect(() => {
		let live = true;
		void loadApp(threadId, item.mcpApp).then(
			(app) => (live ? setLoaded(app) : void client.host("host/mcpApp/release", { id: app.id }).catch(() => {})),
			(failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)),
		);
		return () => {
			live = false;
		};
		// One document per app instance; the call's later states reach it through the bridge.
	}, [threadId, item.id]);

	useLayoutEffect(() => {
		const element = box.current;
		if (!loaded || !element) return;
		const frame = document.createElement("iframe");
		frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
		frame.setAttribute("referrerpolicy", "no-referrer");
		frame.setAttribute("allow", "");
		frame.setAttribute("title", `${item.mcpApp.server} app`);
		frame.src = loaded.url;
		frame.style.cssText = "display: block; width: 100%; height: 100%; border: 0; background: transparent;";
		element.appendChild(frame);
		// One question at a time: a later request waits for the answer to the one shown, so the dialog never changes
		// under the user and no request is left unanswered.
		let asking: Promise<unknown> = Promise.resolve();
		const confirm = (next: Ask) => {
			const turn = asking.then(() => new Promise<boolean>((answer) => setAsk({ ask: next, answer })));
			asking = turn;
			return turn;
		};
		const host: BridgeHost = {
			threadId,
			get appVersion() {
				return versionRef.current;
			},
			theme: () => themeRef.current,
			displayMode: () => mode,
			csp: loaded.csp,
			onSize: setHeight,
			onDisplayMode: (next) => (next === "fullscreen" ? openAppTab(threadId, item.id) : closeAppTab(threadId, item.id)),
			confirmTool: (server, tool) => confirm({ kind: "tool", server, tool }),
			confirmMessage: (text) => confirm({ kind: "message", text }),
			sendMessage: (text) => send(threadId, text),
			openLink: async (url) => void (await client.host("host/shell/openExternal", { url })),
		};
		const instance = new McpAppBridge(frame, new URL(loaded.url).origin, latest.current, host);
		bridge.current = instance;
		return () => {
			bridge.current = undefined;
			const parking = teardownHolder();
			// moveBefore (Chromium 133+; Electron 44 is 152) keeps the frame's document; appendChild would reload it.
			if ("moveBefore" in parking) parking.moveBefore(frame, null);
			else (parking as HTMLElement).appendChild(frame);
			void instance.teardown().finally(() => {
				instance.dispose();
				frame.remove();
				void client.host("host/mcpApp/release", { id: loaded.id }).catch(() => {});
			});
		};
	}, [loaded, mode]);

	useEffect(() => bridge.current?.update(item), [item]);
	useEffect(() => bridge.current?.contextChanged(), [theme]);

	if (error)
		return (
			<div className="mt-1.5 rounded-lg border border-line px-4 py-3 text-sm text-tertiary">
				{error}
			</div>
		);
	const framed = loaded?.prefersBorder !== false;
	return (
		<div
			className={`relative ${mode === "fullscreen" ? "min-h-0 flex-1" : "mt-1.5"} ${framed ? "overflow-hidden rounded-lg border border-line bg-surface" : ""}`}
			style={mode === "fullscreen" ? undefined : { height: Math.max(MIN_HEIGHT, height) }}
		>
			<div ref={box} className="h-full w-full" />
			{!loaded ? <div className="kc-pulse absolute inset-0 flex items-center px-4 text-sm text-tertiary">Loading app…</div> : null}
			{ask ? (
				<AskDialog
					ask={ask.ask}
					onAnswer={(yes) => {
						setAsk(undefined);
						ask.answer(yes);
					}}
				/>
			) : null}
		</div>
	);
}

/** A tool call's app in the transcript: inline, or a note while it is shown full screen in the side panel. */
export function McpAppCard({ threadId, item }: { threadId: string; item: AppItem }) {
	const elsewhere = useStore((s) =>
		(s.tabs[threadId]?.tabs ?? []).some((t) => t.kind === "mcpApp" && t.itemId === item.id),
	);
	return (
		<div className="flex flex-col">
			<div className="flex h-6 items-center gap-1.5 text-sm text-tertiary">
				<span className="min-w-0 flex-1 truncate">
					{item.mcpApp.server} · {item.tool.replace(/^mcp__.+?__/, "")}
				</span>
				{elsewhere ? null : (
					<IconButton label="Show the app in the side panel" size="3xs" onClick={() => openAppTab(threadId, item.id)}>
						<Maximize size={14} />
					</IconButton>
				)}
			</div>
			{elsewhere ? (
				<div className="mt-1.5 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-tertiary">
					Shown in the side panel.{" "}
					<button type="button" className="text-[var(--kc-link)]" onClick={() => closeAppTab(threadId, item.id)}>
						Show it here
					</button>
				</div>
			) : (
				<McpAppView threadId={threadId} item={item} />
			)}
		</div>
	);
}
