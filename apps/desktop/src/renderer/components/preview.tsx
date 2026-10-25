/**
 * A preview tab (desktop-shell.md section 9.8): a 48px toolbar
 * (back, forward and reload in one capsule, the 32px address capsule, then Annotate and Open in browser) over a
 * `<webview>` on the thread's partition. Until it has a page it is a new tab page: the address bar and the
 * tools. Main guards what the webview attaches and where it navigates (main/preview.ts); the address bar refuses
 * anything but http and https before it loads, since main never sees a load the renderer starts.
 */

import type { WebviewTag } from "electron";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { previewAddress, previewPartition } from "../../shared/preview-url.ts";
import { client } from "../client.ts";
import { bindingLabel, matches, useBinding } from "../keys.ts";
import {
	composerAttach,
	getState,
	newTerminal,
	openFilesTab,
	type PanelTab,
	showChanges,
	toast,
	updatePreview,
	useStore,
} from "../store.ts";
import { IconButton, Kbd } from "./button.tsx";
import { ArrowLeft, ArrowRight, ArrowUpRight, File, FileDiff, Pencil, RefreshCw, SquareTerminal, X } from "./icons.tsx";

type Preview = Extract<PanelTab, { kind: "preview" }>;

/** What the tab strip calls a preview: its page's title, else its host, else "New tab". */
export function previewTitle(tab: Preview): string {
	if (tab.title) return tab.title;
	try {
		return tab.url ? new URL(tab.url).host || tab.url : "New tab";
	} catch {
		return tab.url;
	}
}

interface Nav {
	back: boolean;
	forward: boolean;
	loading: boolean;
	/** The main frame's load failed (Chromium's own error, as "ERR_CONNECTION_REFUSED"). */
	failed?: string;
}

/**
 * Annotate: drag a rectangle over the page; main captures that region of the guest and the composer gets it as an
 * image, with the page's address in the draft.
 */
function AnnotateLayer({
	view,
	threadId,
	url,
	onDone,
}: {
	view: WebviewTag;
	threadId: string;
	url: string;
	onDone: () => void;
}) {
	const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
	const layer = useRef<HTMLDivElement>(null);
	useEffect(() => layer.current?.focus(), []);
	const point = (event: React.PointerEvent) => {
		const box = layer.current!.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(event.clientX - box.left, box.width)),
			y: Math.max(0, Math.min(event.clientY - box.top, box.height)),
		};
	};
	const finish = async () => {
		if (!drag) return;
		const css = {
			x: Math.min(drag.x0, drag.x1),
			y: Math.min(drag.y0, drag.y1),
			width: Math.abs(drag.x1 - drag.x0),
			height: Math.abs(drag.y1 - drag.y0),
		};
		setDrag(undefined);
		if (css.width < 4 || css.height < 4) return;
		try {
			// The page's own pixels: its viewport against the element's size (the window's zoom is not the page's).
			const scale = ((await view.executeJavaScript("window.innerWidth")) as number) / layer.current!.clientWidth;
			const rect = {
				x: Math.round(css.x * scale),
				y: Math.round(css.y * scale),
				width: Math.max(1, Math.round(css.width * scale)),
				height: Math.max(1, Math.round(css.height * scale)),
			};
			const { path } = await client.host("host/preview/capture", { webContentsId: view.getWebContentsId(), rect });
			composerAttach(threadId, path, url);
			onDone();
		} catch (error) {
			toast(`Could not capture the page: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};
	const box = drag && {
		left: Math.min(drag.x0, drag.x1),
		top: Math.min(drag.y0, drag.y1),
		width: Math.abs(drag.x1 - drag.x0),
		height: Math.abs(drag.y1 - drag.y0),
	};
	return (
		<div
			ref={layer}
			tabIndex={-1}
			role="application"
			aria-label="Drag over the part of the page to show"
			className="absolute inset-0 z-10 cursor-crosshair bg-black/10 outline-none"
			onKeyDown={(event) => {
				if (matches(event, "desktop.picker.dismiss")) onDone();
			}}
			onPointerDown={(event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				const p = point(event);
				setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
			}}
			onPointerMove={(event) => {
				if (!drag) return;
				const p = point(event);
				setDrag({ ...drag, x1: p.x, y1: p.y });
			}}
			onPointerUp={() => void finish()}
		>
			<div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
				<span className="rounded-full bg-elevated px-3 py-1 text-sm text-ink shadow">
					Drag over the part of the page to show KnightCode
				</span>
			</div>
			{box ? (
				<div
					className="pointer-events-none absolute rounded-sm border-2 border-[var(--kc-accent)] bg-[var(--kc-accent)]/10"
					style={box}
				/>
			) : null}
		</div>
	);
}

/** The new tab page under the bar: the tools a tab can open, with their keys. */
function NewTabPage({ threadId, cwd, tabId }: { threadId: string; cwd: string; tabId: string }) {
	const tools = [
		{
			label: "Changes",
			icon: <FileDiff size={16} />,
			keys: bindingLabel("desktop.panel.toggle"),
			run: () => showChanges(threadId),
		},
		{
			label: "Terminal",
			icon: <SquareTerminal size={16} />,
			keys: bindingLabel("desktop.terminal.new"),
			run: () => void newTerminal(threadId, cwd),
		},
		// Files: the "Open file" tab in place of this new tab page.
		{
			label: "Files",
			icon: <File size={16} />,
			keys: bindingLabel("desktop.files.open"),
			run: () =>
				openFilesTab(
					threadId,
					getState().tabs[threadId]?.tabs.findIndex((t) => t.kind === "preview" && t.id === tabId),
				),
		},
	];
	return (
		<div className="min-h-0 flex-1 overflow-auto px-5 pt-6">
			<h2 className="mb-3 text-sm font-medium text-ink">Tools</h2>
			<div className="grid grid-cols-2 gap-2">
				{tools.map((tool) => (
					<button
						key={tool.label}
						type="button"
						onClick={tool.run}
						className="flex h-11 items-center gap-2.5 rounded-xl bg-soft-alt px-3 text-start text-sm text-ink hover:bg-ghost-hover"
					>
						<span className="text-secondary">{tool.icon}</span>
						<span className="flex-1">{tool.label}</span>
						{tool.keys ? <Kbd>{tool.keys}</Kbd> : null}
					</button>
				))}
			</div>
		</div>
	);
}

export function PreviewTab({ threadId, tab, active }: { threadId: string; tab: Preview; active: boolean }) {
	const holder = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLInputElement>(null);
	const [view, setView] = useState<WebviewTag>();
	const [nav, setNav] = useState<Nav>({ back: false, forward: false, loading: false });
	const [address, setAddress] = useState(tab.url);
	const [editing, setEditing] = useState(false);
	const [refused, setRefused] = useState(false);
	const [annotating, setAnnotating] = useState(false);
	const cwd = useStore((s) => s.held[threadId]?.thread.cwd ?? "");
	const hasPage = tab.url !== "";
	useEffect(() => {
		if (!editing) setAddress(tab.url);
	}, [tab.url, editing]);

	// The webview is made here, not by React: its partition must be set before it attaches, and a re-render must
	// never recreate it (a navigation only changes the tab's url).
	useEffect(() => {
		if (!hasPage || !holder.current) return;
		const element = document.createElement("webview") as WebviewTag;
		element.setAttribute("partition", previewPartition(threadId));
		element.setAttribute("src", tab.url);
		// So a page's window.open reaches main, which never opens a window: an http(s) one loads in this tab instead.
		element.setAttribute("allowpopups", "");
		element.style.cssText = "width: 100%; height: 100%;";
		const sync = (patch: Partial<Nav> = {}) =>
			setNav((n) => ({ ...n, back: element.canGoBack(), forward: element.canGoForward(), ...patch }));
		const navigated = (event: { url: string; isMainFrame?: boolean }) => {
			if (event.isMainFrame === false) return;
			updatePreview(threadId, tab.id, { url: event.url });
			sync({ failed: undefined });
		};
		element.addEventListener("did-navigate", navigated);
		element.addEventListener("did-navigate-in-page", navigated);
		element.addEventListener("page-title-updated", (event) => updatePreview(threadId, tab.id, { title: event.title }));
		element.addEventListener("did-start-loading", () => setNav((n) => ({ ...n, loading: true })));
		element.addEventListener("did-stop-loading", () => sync({ loading: false }));
		element.addEventListener("did-fail-load", (event) => {
			// -3 is a load replaced by another (a click during a load), not a failure. The bar shows what failed.
			if (!event.isMainFrame || event.errorCode === -3) return;
			if (event.validatedURL) updatePreview(threadId, tab.id, { url: event.validatedURL });
			sync({ failed: event.errorDescription || `error ${event.errorCode}` });
		});
		holder.current.appendChild(element);
		setView(element);
		return () => {
			element.remove();
			setView(undefined);
		};
		// One webview for the tab's life once it has a page; navigations go through it.
	}, [threadId, tab.id, hasPage]);

	const go = (typed: string) => {
		const url = previewAddress(typed);
		if (!url) {
			setRefused(true);
			return;
		}
		setRefused(false);
		setEditing(false);
		field.current?.blur();
		if (view) void view.loadURL(url).catch(() => {});
		else updatePreview(threadId, tab.id, { url, title: undefined });
	};

	useBinding(
		"desktop.preview.address",
		() => {
			field.current?.focus();
			field.current?.select();
		},
		active,
	);
	useBinding("desktop.preview.annotate", () => setAnnotating((a) => !a), active && Boolean(view));

	return (
		<div className={`min-h-0 flex-1 flex-col ${active ? "flex" : "hidden"}`}>
			<div className="flex h-12 shrink-0 items-center gap-1.5 p-2">
				<div className="kc-capsule flex h-8 items-center gap-0.5 rounded-full px-0.5">
					<IconButton label="Back" round disabled={!nav.back} onClick={() => view?.goBack()}>
						<ArrowLeft size={16} />
					</IconButton>
					<IconButton label="Forward" round disabled={!nav.forward} onClick={() => view?.goForward()}>
						<ArrowRight size={16} />
					</IconButton>
					<IconButton
						label={nav.loading ? "Stop" : "Reload page"}
						round
						disabled={!view}
						onClick={() => (nav.loading ? view?.stop() : view?.reload())}
					>
						{nav.loading ? <X size={16} /> : <RefreshCw size={16} />}
					</IconButton>
				</div>
				<div
					className={`kc-capsule flex h-8 min-w-0 flex-1 items-center rounded-full p-0.5 ${refused ? "ring-1 ring-[var(--kc-danger)]" : ""}`}
				>
					<input
						ref={field}
						value={address}
						placeholder="Enter a URL"
						aria-label="Address"
						aria-invalid={refused || undefined}
						title={refused ? "Enter an http or https address" : undefined}
						spellCheck={false}
						onFocus={(event) => {
							setEditing(true);
							event.currentTarget.select();
						}}
						onBlur={() => setEditing(false)}
						onChange={(event) => {
							setAddress(event.target.value);
							setRefused(false);
						}}
						onKeyDown={(event) => {
							if (matches(event, "desktop.item.activate")) go(address);
							else if (matches(event, "desktop.picker.dismiss")) {
								setAddress(tab.url);
								setRefused(false);
								event.currentTarget.blur();
							}
						}}
						className="h-7 min-w-0 flex-1 bg-transparent px-2 text-center text-[13px] text-ink outline-none placeholder:text-tertiary focus:text-start"
					/>
				</div>
				<IconButton
					label="Annotate this page"
					round
					aria-pressed={annotating}
					disabled={!view}
					className="kc-capsule size-8 rounded-full"
					onClick={() => setAnnotating((a) => !a)}
				>
					<Pencil size={16} />
				</IconButton>
				<IconButton
					label="Open in browser"
					round
					disabled={!hasPage}
					className="kc-capsule size-8 rounded-full"
					onClick={() => void client.host("host/shell/openExternal", { url: tab.url }).catch(() => {})}
				>
					<ArrowUpRight size={16} />
				</IconButton>
			</div>
			{hasPage ? (
				<div className="relative min-h-0 flex-1 border-t border-line">
					<div ref={holder} className="absolute inset-0" />
					{nav.failed ? (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface px-6 text-center">
							<p className="text-base font-medium text-ink">This page could not be loaded</p>
							<p className="text-sm text-tertiary">{nav.failed}</p>
							<button type="button" className="text-sm text-[var(--kc-link)]" onClick={() => view?.reload()}>
								Try again
							</button>
						</div>
					) : null}
					{annotating && view ? (
						<AnnotateLayer view={view} threadId={threadId} url={tab.url} onDone={() => setAnnotating(false)} />
					) : null}
				</div>
			) : (
				<NewTabPage threadId={threadId} cwd={cwd} tabId={tab.id} />
			)}
		</div>
	);
}
