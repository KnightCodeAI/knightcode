/**
 * The bottom region and its terminals (desktop-shell.md section 9.7), as Codex's bottom panel (26.1016, measured
 * 2026-10-23): a 40px strip of tabs with + and a chevron that hides the region, over xterm.js drawing a shell main
 * runs (main/terminals.ts). The region spans the chat and the side panel, resizes from its top edge, and holds the
 * open thread's terminals.
 */

import { FitAddon } from "@xterm/addon-fit";
import { type ILink, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { KeybindingId } from "../../shared/keybindings.ts";
import { client } from "../client.ts";
import { followDrag } from "../drag.ts";
import { basename } from "../format.ts";
import { isMac, matches, useBinding } from "../keys.ts";
import {
	activateTerminal,
	closeTerminal,
	newTerminal,
	restartTerminal,
	selectPreferences,
	setBottom,
	setTerminalsOpen,
	type TerminalTab,
	updateTerminal,
	useStore,
	NO_TERMINALS,
} from "../store.ts";
import { Button, IconButton } from "./button.tsx";
import { ChevronDown, MoreHorizontal, Plus, SquareTerminal } from "./icons.tsx";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "./menu.tsx";
import { StripSlot, StripTab } from "./strip-tab.tsx";

/** Codex's bottom panel: 280px until dragged, never under 160px, shut when dragged under 80px. */
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 160;
/** What the region leaves the thread above it. */
const ABOVE_MIN = 160;

/** App bindings a terminal leaves to the window, as Codex's terminal does; every other key goes to the shell. */
const OVER_TERMINAL: KeybindingId[] = [
	"desktop.terminal.toggle",
	"desktop.terminal.new",
	"desktop.terminal.next",
	"desktop.terminal.previous",
	"desktop.palette",
	"desktop.sidebar.toggle",
	"desktop.panel.toggle",
	"desktop.thread.new",
];
const overTerminal = (event: KeyboardEvent) => OVER_TERMINAL.some((id) => matches(event, id));

/** Codex's palette: the theme's tokens resolved to colours xterm reads (a probe element resolves `var()`). */
function terminalTheme(host: HTMLElement) {
	const probe = document.createElement("span");
	host.appendChild(probe);
	const color = (token: string) => {
		probe.style.color = `var(${token})`;
		return getComputedStyle(probe).color;
	};
	const [red, green, yellow, blue, magenta] = ["red", "green", "yellow", "blue", "magenta"].map((c) =>
		color(`--kc-ansi-${c}`),
	);
	const background = color("--kc-terminal-bg");
	const foreground = color("--kc-terminal-fg");
	const theme = {
		background,
		foreground,
		cursor: foreground,
		cursorAccent: background,
		selectionBackground: color("--kc-terminal-selection"),
		black: color("--kc-ansi-black"),
		red,
		green,
		yellow,
		blue,
		magenta,
		cyan: blue,
		white: foreground,
		brightBlack: color("--kc-ansi-bright-black"),
		brightRed: red,
		brightGreen: green,
		brightYellow: yellow,
		brightBlue: blue,
		brightMagenta: magenta,
		brightCyan: blue,
		brightWhite: foreground,
	};
	probe.remove();
	return theme;
}

const URL_PATTERN = /https?:\/\/[^\s"'<>`]+[^\s"'<>`.,;:!?)\]]/g;

/** http(s) links in the output open in the browser on a click (Codex loads xterm's web links addon). */
function linkProvider(term: Terminal) {
	return {
		provideLinks(line: number, callback: (links: ILink[] | undefined) => void) {
			const text = term.buffer.active.getLine(line - 1)?.translateToString(true) ?? "";
			const links = [...text.matchAll(URL_PATTERN)].map(
				(m): ILink => ({
					text: m[0],
					range: { start: { x: m.index + 1, y: line }, end: { x: m.index + m[0].length, y: line } },
					activate: () => void client.host("host/shell/openExternal", { url: m[0] }).catch(() => {}),
				}),
			);
			callback(links.length > 0 ? links : undefined);
		},
	};
}

/** Inside the thread's own folder (its worktree or checkout), whatever the separators and, on Windows, the case. */
function inside(cwd: string, root: string): boolean {
	const norm = (p: string) => {
		const slashes = p.replaceAll("\\", "/").replace(/\/+$/, "");
		return window.knightcode.platform === "win32" ? slashes.toLowerCase() : slashes;
	};
	const [c, r] = [norm(cwd), norm(root)];
	return c === r || c.startsWith(`${r}/`);
}

/** One terminal: xterm attached to main's shell, its output so far first, then what follows. */
function TerminalView({ threadId, tab, active }: { threadId: string; tab: TerminalTab; active: boolean }) {
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<Terminal | undefined>(undefined);
	const fit = useRef<FitAddon | undefined>(undefined);
	const theme = useStore((s) => s.resolvedTheme);
	const fontSize = useStore((s) => selectPreferences(s).codeFontSize ?? 12);
	const { terminalId } = tab;
	// Only a terminal on screen is measured: a hidden one measures one row, and resizing the shell to it would push
	// its screen into the scrollback.
	const fitShown = () => {
		if (host.current?.offsetParent) fit.current?.fit();
	};

	useEffect(() => {
		const element = host.current!;
		const xterm = new Terminal({
			fontFamily: getComputedStyle(element).getPropertyValue("--kc-font-code"),
			fontSize,
			theme: terminalTheme(element),
			cursorBlink: true,
			scrollback: 5000,
			// OSC 8 hyperlinks open in the browser too.
			linkHandler: { activate: (_event, url) => void client.host("host/shell/openExternal", { url }).catch(() => {}) },
		});
		const fitter = new FitAddon();
		xterm.loadAddon(fitter);
		xterm.registerLinkProvider(linkProvider(xterm));
		xterm.open(element);
		term.current = xterm;
		fit.current = fitter;

		// Main's events for this terminal count only after its scrollback: anything sent before the attach answered is in it.
		let attached = false;
		const off = client.onHostEvent((event) => {
			if (attached && event.event === "terminal/data" && event.terminalId === terminalId) xterm.write(event.data);
		});
		void client.host("host/terminal/attach", { terminalId }).then(
			({ scrollback, exitCode }) => {
				xterm.write(scrollback);
				attached = true;
				// It ended while no window of this page was attached (after a reload), so its exit event went nowhere.
				if (exitCode !== undefined) updateTerminal(threadId, terminalId, { exitCode });
			},
			() => {},
		);
		const input = xterm.onData((data) => void client.host("host/terminal/write", { terminalId, data }).catch(() => {}));
		const resize = xterm.onResize(
			({ cols, rows }) => void client.host("host/terminal/resize", { terminalId, cols, rows }).catch(() => {}),
		);
		const title = xterm.onTitleChange((next) => updateTerminal(threadId, terminalId, { title: next }));

		// Copy and paste as Codex's, off macOS (where the Edit menu does both): copy only with a selection, so Ctrl+C
		// without one still interrupts the shell.
		xterm.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;
			if (overTerminal(event)) return false;
			if (isMac()) return true;
			if (matches(event, "desktop.terminal.copy") && xterm.hasSelection()) {
				event.preventDefault();
				void client.host("host/clipboard/writeText", { text: xterm.getSelection() }).catch(() => {});
				return false;
			}
			if (matches(event, "desktop.terminal.paste")) {
				event.preventDefault();
				void client.host("host/clipboard/readText", {}).then(({ text }) => text && xterm.paste(text), () => {});
				return false;
			}
			return true;
		});
		// Keys the shell gets stop here, so a window binding (Escape stopping the turn) never runs for them.
		const keep = (event: KeyboardEvent) => {
			if (!overTerminal(event)) event.stopPropagation();
		};
		element.addEventListener("keydown", keep);

		const observer = new ResizeObserver(fitShown);
		observer.observe(element);
		return () => {
			observer.disconnect();
			element.removeEventListener("keydown", keep);
			off();
			input.dispose();
			resize.dispose();
			title.dispose();
			xterm.dispose();
			term.current = undefined;
			fit.current = undefined;
		};
		// The font size and theme update in place (below); a new terminal id is a new xterm.
	}, [terminalId, threadId]);

	useEffect(() => {
		const xterm = term.current;
		if (!xterm || !host.current) return;
		xterm.options.theme = terminalTheme(host.current);
		xterm.options.fontSize = fontSize;
		fitShown();
	}, [theme, fontSize]);

	useEffect(() => {
		if (!active) return;
		fitShown();
		term.current?.focus();
	}, [active]);

	return (
		<div
			className={`relative min-h-0 flex-1 flex-col bg-[var(--kc-terminal-bg)] text-[var(--kc-terminal-fg)] ${active ? "flex" : "hidden"}`}
		>
			{/* Codex's padding: 8px over, 16px before, 12px under the text. */}
			<div className="min-h-0 flex-1 overflow-hidden ps-4 pt-2 pb-3">
				<div ref={host} className="h-full w-full overflow-hidden" />
			</div>
		</div>
	);
}

/** Codex's notices over a terminal: its shell ended; or it runs outside the thread's folder (after a handoff). */
function TerminalNotice({ threadId, index, tab, cwd }: { threadId: string; index: number; tab: TerminalTab; cwd: string }) {
	if (tab.exitCode !== undefined)
		return (
			<div role="status" className="flex h-6 shrink-0 items-center gap-2 px-2 text-xs text-secondary select-none">
				<span className="min-w-0 truncate">
					{tab.exitCode === 0 ? "Shell exited" : `Shell exited with code ${tab.exitCode}`}
				</span>
				<Button variant="ghost" size="sm" onClick={() => void restartTerminal(threadId, index)}>
					Restart
				</Button>
			</div>
		);
	if (tab.dismissed || !cwd || inside(tab.cwd, cwd)) return null;
	return (
		<div role="status" className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-sm text-secondary">
			<span className="min-w-0 flex-1 truncate">This terminal is outside this chat's workspaces</span>
			<Button variant="ghost" size="sm" onClick={() => updateTerminal(threadId, tab.terminalId, { dismissed: true })}>
				Dismiss
			</Button>
			<Button variant="solid" size="sm" onClick={() => void newTerminal(threadId, cwd)}>
				Open new terminal
			</Button>
		</div>
	);
}

/**
 * The region's top edge: a 16px handle centred on it (Codex's) that drags the height between 160px and what leaves the
 * thread 160px; dragged under 80px the region shuts.
 */
function ResizeHandle({ threadId, height }: { threadId: string; height: number }) {
	const start = (event: React.PointerEvent) => {
		event.preventDefault();
		const from = event.clientY;
		const region = event.currentTarget.parentElement!;
		const initial = region.getBoundingClientRect().height;
		const max = Math.max(MIN_HEIGHT, region.parentElement!.getBoundingClientRect().height - ABOVE_MIN);
		followDrag((e: PointerEvent) => {
			const size = initial - (e.clientY - from);
			setTerminalsOpen(threadId, size >= MIN_HEIGHT / 2);
			if (size >= MIN_HEIGHT / 2) setBottom({ height: Math.min(Math.max(size, MIN_HEIGHT), max) });
		});
	};
	return (
		<div
			onPointerDown={start}
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize the terminal"
			aria-valuenow={height}
			aria-valuemin={MIN_HEIGHT}
			className="absolute inset-x-0 -top-2 z-10 h-4 cursor-row-resize"
		/>
	);
}

export function BottomRegion({ threadId, cwd }: { threadId: string; cwd: string }) {
	const { tabs, active } = useStore((s) => s.terminals[threadId] ?? NO_TERMINALS);
	const height = useStore((s) => s.bottom.height) || DEFAULT_HEIGHT;
	const [shells, setShells] = useState<{ id: string; name: string }[]>([]);
	useEffect(() => {
		void client.host("host/terminal/shells", {}).then(({ shells: found }) => setShells(found), () => {});
	}, []);
	useBinding("desktop.terminal.next", () => activateTerminal(threadId, (active + 1) % Math.max(1, tabs.length)), tabs.length > 1);
	useBinding(
		"desktop.terminal.previous",
		() => activateTerminal(threadId, (active - 1 + tabs.length) % Math.max(1, tabs.length)),
		tabs.length > 1,
	);
	const shown = tabs[active];
	return (
		<section
			aria-label="Terminal"
			style={{ height: `min(${height}px, max(${MIN_HEIGHT}px, 100% - ${ABOVE_MIN}px))` }}
			className="relative flex shrink-0 flex-col border-t border-line bg-[var(--kc-terminal-bg)]"
		>
			<ResizeHandle threadId={threadId} height={height} />
			<div className="flex h-10 shrink-0 items-center gap-1.5 ps-2 pe-1.5">
				<div role="tablist" aria-label="Terminals" className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]">
					{tabs.map((tab, i) => (
						<StripSlot key={tab.terminalId} divider={i !== active && i + 1 !== active && i !== tabs.length - 1}>
							<StripTab
								icon={<SquareTerminal size={16} className="shrink-0" />}
								title={`${tab.shellName} · ${basename(tab.cwd)}`}
								tooltip={tab.title ? `${tab.title}\n${tab.cwd}` : tab.cwd}
								active={i === active}
								onSelect={() => activateTerminal(threadId, i)}
								onClose={() => closeTerminal(threadId, i)}
							/>
						</StripSlot>
					))}
				</div>
				<IconButton label="New terminal" onClick={() => void newTerminal(threadId, cwd)}>
					<Plus size={16} />
				</IconButton>
				{shells.length > 1 ? (
					<Menu>
						<MenuTrigger>
							<IconButton label="Choose a shell">
								<MoreHorizontal size={16} />
							</IconButton>
						</MenuTrigger>
						<MenuContent align="start">
							<MenuLabel>New terminal</MenuLabel>
							{shells.map((shell) => (
								<MenuItem key={shell.id} onSelect={() => void newTerminal(threadId, cwd, shell.id)}>
									{shell.name}
								</MenuItem>
							))}
						</MenuContent>
					</Menu>
				) : null}
				<div className="flex-1" />
				<IconButton label="Hide the terminal" onClick={() => setTerminalsOpen(threadId, false)}>
					<ChevronDown size={16} />
				</IconButton>
			</div>
			{shown ? <TerminalNotice threadId={threadId} index={active} tab={shown} cwd={cwd} /> : null}
			{tabs.map((tab, i) => (
				<TerminalView key={tab.terminalId} threadId={threadId} tab={tab} active={i === active} />
			))}
		</section>
	);
}
