/** Archived threads (desktop-shell.md section 9.2): search, unarchive, delete for good. */

import type { ThreadSummary } from "@knightcode/app-server-protocol";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { basename, relativeTime } from "../format.ts";
import { deleteThread, listArchived, toast, unarchive, useStore } from "../store.ts";

export function ArchiveView() {
	const [threads, setThreads] = useState<ThreadSummary[] | undefined>();
	const [query, setQuery] = useState("");
	const [confirming, setConfirming] = useState<string | undefined>();
	const load = useCallback(() => {
		listArchived()
			.then(setThreads)
			.catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
	}, []);
	// Archiving elsewhere (the sidebar, another window) changes the live list; reread then.
	const live = useStore((s) => s.threads);
	useEffect(load, [load, live]);
	const q = query.trim().toLowerCase();
	const shown = threads?.filter((t) => !q || t.name.toLowerCase().includes(q)) ?? [];
	return (
		<div className="min-w-0 flex-1 overflow-y-auto">
			<div className="mx-auto max-w-3xl px-8 py-8">
				<h2 className="mb-1 text-xl font-semibold">Archived threads</h2>
				<p className="mb-5 text-muted">Archived threads stay on disk. Unarchive one to see it in the sidebar again.</p>
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search archived threads"
					className="mb-4 h-9 w-full rounded-lg border border-line bg-sidebar px-3 outline-none focus:border-line-strong"
				/>
				{threads === undefined ? <div className="kc-pulse text-faint">Loading…</div> : null}
				{threads?.length === 0 ? <div className="text-muted">No archived threads.</div> : null}
				<div className={shown.length ? "divide-y divide-line rounded-xl border border-line bg-sidebar" : "hidden"}>
					{shown.map((t) => (
						<div key={t.id} className="flex items-center gap-3 px-4 py-3">
							<div className="min-w-0 flex-1">
								<div className="truncate">{t.name || "Untitled"}</div>
								<div className="truncate text-[13px] text-faint">
									{basename(t.cwd)} · {relativeTime(t.updatedAt)}
								</div>
							</div>
							{confirming === t.id ? (
								<>
									<span className="text-[13px] text-danger">Delete for good? This cannot be undone.</span>
									<button
										type="button"
										onClick={() => {
											setConfirming(undefined);
											void deleteThread(t.id).then(load);
										}}
										className="rounded-lg bg-danger px-2.5 py-1 font-medium text-white"
									>
										Delete
									</button>
									<button
										type="button"
										onClick={() => setConfirming(undefined)}
										className="rounded-lg px-2.5 py-1 hover:bg-hover"
									>
										Cancel
									</button>
								</>
							) : (
								<>
									<button
										type="button"
										onClick={() => void unarchive(t.id).then(load)}
										className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted hover:bg-hover hover:text-ink"
									>
										<ArchiveRestore size={14} /> Unarchive
									</button>
									<button
										type="button"
										title="Delete"
										onClick={() => setConfirming(t.id)}
										className="rounded-lg p-1.5 text-faint hover:bg-hover hover:text-danger"
									>
										<Trash2 size={14} />
									</button>
								</>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
