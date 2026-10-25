/**
 * The command palette (desktop-shell.md section 9.11), laid out as Codex's command menu (measured 2026-10-19): a
 * 520px card a fifth of the way down the window with the search field on top, then the matches in groups (recent
 * threads with their project, settings pages, quick actions with their shortcuts). Rows are 31px with 12.5px corners;
 * the selected one is lit and the others sit at 75%. Arrows move the selection, Enter runs it, Escape closes.
 */

import { type ReactNode, useEffect, useId, useState } from "react";
import { GO_TO_THREAD, type KeybindingId } from "../../shared/keybindings.ts";
import { basename, samePath } from "../format.ts";
import { bindingLabel, matches } from "../keys.ts";
import {
	addProject,
	getState,
	navigate,
	newTerminal,
	openThread,
	selectProjects,
	setPaletteOpen,
	setSidebarOpen,
	showNew,
	threadSlotsOf,
	toggleTerminal,
	useStore,
} from "../store.ts";
import { Kbd } from "./button.tsx";
import { Dialog } from "./dialog.tsx";
import { FolderOpen, Keyboard, PanelLeft, Settings, SquarePen, SquareTerminal } from "./icons.tsx";
import { SETTINGS_PAGES } from "./settings.tsx";

interface Entry {
	id: string;
	label: string;
	/** A thread's project, in a column before the shortcut. */
	detail?: string;
	icon?: ReactNode;
	binding?: KeybindingId;
	run: () => void;
}

export function Palette() {
	const threads = useStore((s) => s.threads);
	const projects = useStore(selectProjects);
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	// The open thread, for the terminal's actions.
	const open = useStore((s) => (s.view.kind === "thread" ? s.held[s.view.id]?.thread : undefined));
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const listId = useId();
	const q = query.trim().toLowerCase();
	const slots = threadSlotsOf(getState()).slice(0, GO_TO_THREAD.length);
	const has = (text: string) => !q || text.toLowerCase().includes(q);
	const project = (cwd: string) => projects.find((p) => samePath(p.path, cwd))?.name ?? basename(cwd);
	const actions: Entry[] = [
		{
			id: "new",
			label: "New thread",
			icon: <SquarePen size={16} />,
			binding: "desktop.thread.new",
			run: () => showNew(),
		},
		{
			id: "folder",
			label: "Open folder",
			icon: <FolderOpen size={16} />,
			binding: "desktop.project.open",
			run: () => void addProject(),
		},
		{
			id: "sidebar",
			label: sidebarOpen ? "Hide sidebar" : "Show sidebar",
			icon: <PanelLeft size={16} />,
			binding: "desktop.sidebar.toggle",
			run: () => setSidebarOpen(!sidebarOpen),
		},
		...(open
			? [
					{
						id: "terminal",
						label: "Toggle terminal",
						icon: <SquareTerminal size={16} />,
						binding: "desktop.terminal.toggle" as const,
						run: () => toggleTerminal(open.id, open.cwd),
					},
					{
						id: "newTerminal",
						label: "New terminal",
						icon: <SquareTerminal size={16} />,
						binding: "desktop.terminal.new" as const,
						run: () => void newTerminal(open.id, open.cwd),
					},
				]
			: []),
		{
			id: "settings",
			label: "Settings",
			icon: <Settings size={16} />,
			binding: "desktop.settings",
			run: () => navigate({ kind: "settings", page: "general" }),
		},
		{
			id: "shortcuts",
			label: "Keyboard shortcuts",
			icon: <Keyboard size={16} />,
			binding: "desktop.shortcuts",
			run: () => navigate({ kind: "settings", page: "shortcuts" }),
		},
	];
	const groups = [
		{
			// Before a query, the threads Alt+1-9 reach, in the sidebar's order (as Codex lists them); after one, the
			// matches newest first, still showing the shortcut of any that has one.
			title: "Threads",
			entries: (q ? threads.filter((t) => has(t.name)).slice(0, 30) : slots).map((t): Entry => {
				const slot = slots.findIndex((u) => u.id === t.id);
				return {
					id: t.id,
					label: t.name || "Untitled",
					detail: project(t.projectCwd),
					...(slot >= 0 ? { binding: GO_TO_THREAD[slot] } : {}),
					run: () => void openThread(t.id),
				};
			}),
		},
		{
			// Settings pages are found by name, as Codex's.
			title: "Settings",
			entries: q
				? SETTINGS_PAGES.filter((p) => has(p.label)).map((p): Entry => ({
						id: `settings:${p.page}`,
						label: p.label,
						icon: p.icon,
						run: () => navigate({ kind: "settings", page: p.page }),
					}))
				: [],
		},
		{ title: "Quick actions", entries: actions.filter((a) => has(a.label)) },
	].filter((g) => g.entries.length > 0);
	const entries = groups.flatMap((g) => g.entries);
	const optionId = (i: number) => `${listId}-${i}`;
	useEffect(() => {
		setSelected(0);
	}, [query]);
	// Braced: Chromium's scrollIntoView returns a promise, which an effect must not return.
	useEffect(() => {
		document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" });
	});
	const close = () => setPaletteOpen(false);
	const run = (entry: Entry | undefined) => {
		if (!entry) return;
		close();
		entry.run();
	};
	let index = 0;
	return (
		<Dialog variant="card" placement="top" width={520} title="Command palette" onClose={close}>
			<input
				role="combobox"
				aria-label="Search threads and commands"
				aria-expanded
				aria-controls={listId}
				aria-activedescendant={entries.length ? optionId(selected) : undefined}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={(e) => {
					const step = matches(e, "desktop.picker.next") ? 1 : matches(e, "desktop.picker.previous") ? -1 : 0;
					if (step && entries.length) {
						e.preventDefault();
						setSelected((selected + step + entries.length) % entries.length);
					} else if (matches(e, "desktop.composer.send")) {
						e.preventDefault();
						run(entries[selected]);
					}
				}}
				placeholder="Search threads and commands"
				className="h-[33px] w-full bg-transparent px-2.5 text-base outline-none placeholder:text-tertiary focus-visible:outline-none"
			/>
			<div
				id={listId}
				role="listbox"
				aria-label="Suggestions"
				className="flex max-h-[440px] flex-col gap-1 overflow-y-auto [scrollbar-width:none]"
			>
				{entries.length === 0 ? <div className="py-6 text-center text-sm text-tertiary">No matches</div> : null}
				{groups.map((group) => (
					<div key={group.title} role="group" aria-label={group.title} className="flex flex-col">
						<div className="px-2 pt-2 pb-0 text-sm text-tertiary">{group.title}</div>
						{group.entries.map((entry) => {
							const i = index++;
							return (
								<div
									key={entry.id}
									id={optionId(i)}
									role="option"
									aria-selected={i === selected}
									onMouseMove={() => setSelected(i)}
									onClick={() => run(entry)}
									className={`flex h-[31px] shrink-0 cursor-default items-center gap-2 rounded-lg px-2 text-base [corner-shape:var(--kc-corner-shape)] ${i === selected ? "bg-ghost-hover" : "opacity-75"}`}
								>
									<span className="flex size-4 shrink-0 items-center justify-center">{entry.icon}</span>
									<span className="min-w-0 flex-1 truncate">{entry.label}</span>
									{entry.detail ? (
										<span className="w-24 shrink-0 truncate text-sm text-tertiary">{entry.detail}</span>
									) : null}
									{entry.binding ? (
										<span className="opacity-80">
											<Kbd>{bindingLabel(entry.binding)}</Kbd>
										</span>
									) : null}
								</div>
							);
						})}
					</div>
				))}
			</div>
		</Dialog>
	);
}
