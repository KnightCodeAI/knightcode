/**
 * The title bar (desktop-shell.md section 9.1): sidebar toggle, back and forward, then the menu,
 * inline as in Codex; the rest of the bar drags the window. Windows draws its caption buttons over
 * the right end (titleBarOverlay); macOS keeps its traffic lights at the left.
 */

import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import { client } from "../client.ts";
import { isMac } from "../keys.ts";
import type { AppCommandName } from "../../shared/host-protocol.ts";
import { addProject, goBack, navigate, setPaletteOpen, setSidebarOpen, showNew, useStore } from "../store.ts";
import { MenuItem, Popover } from "./popover.tsx";

const run = (command: AppCommandName) => void client.host("host/app/command", { command });

function IconButton({
	title,
	onClick,
	disabled,
	children,
}: {
	title: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			className="no-drag flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:text-faint disabled:opacity-50 disabled:hover:bg-transparent"
		>
			{children}
		</button>
	);
}

function Menu({ label, items }: { label: string; items: ({ label: string; hint?: string; run: () => void } | "-")[] }) {
	return (
		<Popover
			side="bottom"
			trigger={(open) => (
				<button
					type="button"
					className={`no-drag rounded-md px-2.5 py-1 text-[13px] ${open ? "bg-hover text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
				>
					{label}
				</button>
			)}
		>
			{(close) => (
				<div className="w-60">
					{items.map((item, i) =>
						item === "-" ? (
							<div key={i} className="my-1 border-t border-line" />
						) : (
							<MenuItem
								key={item.label}
								onClick={() => {
									close();
									item.run();
								}}
							>
								<span className="flex justify-between gap-4">
									<span>{item.label}</span>
									{item.hint ? <span className="text-faint">{item.hint}</span> : null}
								</span>
							</MenuItem>
						),
					)}
				</div>
			)}
		</Popover>
	);
}

export function TitleBar() {
	const history = useStore((s) => s.history);
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const mod = isMac() ? "⌘" : "Ctrl+";
	return (
		<div
			className={`drag flex h-10 shrink-0 items-center gap-0.5 bg-shell ${isMac() ? "pl-20" : "pl-2"} ${isMac() ? "pr-2" : "pr-36"}`}
		>
			<IconButton title="Toggle sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
				<PanelLeft size={16} />
			</IconButton>
			<IconButton title="Back" onClick={() => goBack(-1)} disabled={history.index === 0}>
				<ArrowLeft size={16} />
			</IconButton>
			<IconButton title="Forward" onClick={() => goBack(1)} disabled={history.index >= history.stack.length - 1}>
				<ArrowRight size={16} />
			</IconButton>
			{isMac() ? null : (
				<div className="ml-2 flex items-center">
					<Menu
						label="File"
						items={[
							{ label: "New thread", hint: `${mod}N`, run: () => showNew() },
							{ label: "Add project folder…", hint: `${mod}O`, run: () => void addProject() },
							"-",
							{ label: "Settings", hint: `${mod},`, run: () => navigate({ kind: "settings", page: "general" }) },
							{ label: "Archived threads", run: () => navigate({ kind: "archive" }) },
							"-",
							{ label: "Quit", run: () => run("quit") },
						]}
					/>
					<Menu
						label="Edit"
						items={[
							{ label: "Undo", hint: `${mod}Z`, run: () => run("undo") },
							{ label: "Redo", hint: `${mod}Y`, run: () => run("redo") },
							"-",
							{ label: "Cut", hint: `${mod}X`, run: () => run("cut") },
							{ label: "Copy", hint: `${mod}C`, run: () => run("copy") },
							{ label: "Paste", hint: `${mod}V`, run: () => run("paste") },
							{ label: "Select all", hint: `${mod}A`, run: () => run("selectAll") },
						]}
					/>
					<Menu
						label="View"
						items={[
							{ label: "Command palette", hint: `${mod}K`, run: () => setPaletteOpen(true) },
							{ label: "Toggle sidebar", hint: `${mod}B`, run: () => setSidebarOpen(!sidebarOpen) },
							"-",
							{ label: "Zoom in", run: () => run("zoomIn") },
							{ label: "Zoom out", run: () => run("zoomOut") },
							{ label: "Actual size", run: () => run("resetZoom") },
							"-",
							{ label: "Reload", run: () => run("reload") },
							{ label: "Developer tools", run: () => run("toggleDevTools") },
						]}
					/>
					<Menu
						label="Help"
						items={[
							{ label: "Keyboard shortcuts", run: () => navigate({ kind: "settings", page: "shortcuts" }) },
							{
								label: "Documentation",
								run: () => void client.host("host/shell/openExternal", { url: "https://knightcode.dev/docs" }),
							},
							{ label: "About KnightCode", run: () => navigate({ kind: "settings", page: "about" }) },
						]}
					/>
				</div>
			)}
		</div>
	);
}
