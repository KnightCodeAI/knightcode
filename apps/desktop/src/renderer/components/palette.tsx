/** The command palette (desktop-shell.md section 9.11): actions and threads, one search. */

import { CornerDownLeft, MessageSquare, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { matches } from "../keys.ts";
import { addProject, navigate, openThread, setPaletteOpen, setSidebarOpen, showNew, useStore } from "../store.ts";

interface Entry {
	id: string;
	label: string;
	detail?: string;
	kind: "action" | "thread";
	run: () => void;
}

export function Palette() {
	const threads = useStore((s) => s.threads);
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const actions: Entry[] = useMemo(
		() => [
			{ id: "new", label: "New thread", kind: "action", run: () => showNew() },
			{ id: "project", label: "Add project folder", kind: "action", run: () => void addProject() },
			{ id: "sidebar", label: "Toggle sidebar", kind: "action", run: () => setSidebarOpen(!sidebarOpen) },
			{ id: "settings", label: "Settings", kind: "action", run: () => navigate({ kind: "settings", page: "general" }) },
			{
				id: "models",
				label: "Models & accounts",
				kind: "action",
				run: () => navigate({ kind: "settings", page: "models" }),
			},
			{
				id: "shortcuts",
				label: "Keyboard shortcuts",
				kind: "action",
				run: () => navigate({ kind: "settings", page: "shortcuts" }),
			},
			{ id: "archive", label: "Archived threads", kind: "action", run: () => navigate({ kind: "archive" }) },
		],
		[sidebarOpen],
	);
	const q = query.trim().toLowerCase();
	const entries = [
		...actions.filter((a) => !q || a.label.toLowerCase().includes(q)),
		...threads
			.filter((t) => !q || t.name.toLowerCase().includes(q))
			.slice(0, 30)
			.map((t): Entry => ({
				id: t.id,
				label: t.name || "Untitled",
				detail: t.cwd,
				kind: "thread",
				run: () => void openThread(t.id),
			})),
	];
	useEffect(() => setSelected(0), [query]);
	const run = (entry: Entry | undefined) => {
		if (!entry) return;
		setPaletteOpen(false);
		entry.run();
	};
	return (
		<div
			className="fixed inset-0 z-40 flex justify-center bg-black/40 pt-[12vh]"
			onMouseDown={() => setPaletteOpen(false)}
		>
			<div
				className="h-fit w-[560px] overflow-hidden rounded-2xl border border-line-strong bg-elevated shadow-2xl"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<input
					autoFocus
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (matches(e, "desktop.picker.next")) {
							e.preventDefault();
							setSelected((selected + 1) % Math.max(entries.length, 1));
						} else if (matches(e, "desktop.picker.previous")) {
							e.preventDefault();
							setSelected((selected - 1 + entries.length) % Math.max(entries.length, 1));
						} else if (matches(e, "desktop.composer.send")) {
							e.preventDefault();
							run(entries[selected]);
						} else if (matches(e, "desktop.picker.dismiss")) {
							e.preventDefault();
							setPaletteOpen(false);
						}
					}}
					placeholder="Search actions and threads"
					className="h-12 w-full border-b border-line bg-transparent px-4 text-[15px] outline-none placeholder:text-faint focus-visible:outline-none"
				/>
				<div className="max-h-[50vh] overflow-y-auto p-1.5">
					{entries.length === 0 ? <div className="px-3 py-2 text-muted">No matches</div> : null}
					{entries.map((entry, i) => (
						<button
							key={`${entry.kind}:${entry.id}`}
							type="button"
							onMouseEnter={() => setSelected(i)}
							onClick={() => run(entry)}
							className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === selected ? "bg-hover" : ""}`}
						>
							{entry.kind === "action" ? (
								<Zap size={15} className="shrink-0 text-muted" />
							) : (
								<MessageSquare size={15} className="shrink-0 text-muted" />
							)}
							<span className="min-w-0 truncate">{entry.label}</span>
							{entry.detail ? (
								<span className="min-w-0 flex-1 truncate text-right text-[12px] text-faint">{entry.detail}</span>
							) : (
								<span className="flex-1" />
							)}
							{i === selected ? <CornerDownLeft size={13} className="shrink-0 text-faint" /> : null}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
