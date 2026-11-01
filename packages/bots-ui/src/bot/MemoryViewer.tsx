// What a bot remembers: its notes (read, download, delete, share with all bots), its open work, and the facts every
// bot shares. Notes older than a day show their age, since they may be out of date.
import type { Bot, Note } from "@knightcode/bots-protocol";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { useToast } from "../primitives/Toast.tsx";
import { useResource, useStore } from "../state/store.ts";
import { OpenWork } from "./OpenWork.tsx";

const DAY = 86_400_000;

/** "47 days ago" for notes older than a day, else undefined. */
export function noteAge(updatedAt: number, now = Date.now()): string | undefined {
	const days = Math.floor((now - updatedAt) / DAY);
	if (days < 1) return undefined;
	return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The memory panel in a bot's details pane. */
export function MemoryViewer({ bot }: { bot: Bot }) {
	const store = useStore();
	const toast = useToast();
	const key = `notes:${bot.id}`;
	const { data } = useResource(key, (api) => api.listNotes({ botId: bot.id }));
	const { data: shared } = useResource("memory:shared", (api) => api.getSharedMemory({}));
	const [chosen, setChosen] = useState<string[]>([]);
	const [open, setOpen] = useState<string>();
	const notes = data?.notes ?? [];
	const share = async () => {
		const result = await store.api.shareNotes({ botId: bot.id, names: chosen });
		setChosen([]);
		store.reload(key);
		store.reload("memory:shared");
		toast({
			text: result.keptPrivate
				? `Shared ${result.shared}. Kept ${result.keptPrivate} that looked private.`
				: `Shared ${result.shared} with all your bots.`,
		});
	};
	return (
		<div className="kb-memory">
			<section className="kb-memory__section" aria-labelledby="memory-notes">
				<div className="kb-memory__head">
					<h3 id="memory-notes" className="kb-memory__title">
						Notes
					</h3>
					{chosen.length > 0 && (
						<Button variant="subtle" size="sm" onClick={() => void share()}>
							Share with all my bots
						</Button>
					)}
				</div>
				{notes.length === 0 && <p className="kb-settings__hint">Nothing remembered yet.</p>}
				<ul className="kb-memory__list">
					{notes.map((note) => (
						<li key={note.name} className="kb-memory__note">
							<div className="kb-memory__row">
								<input
									type="checkbox"
									aria-label={`Choose ${note.description}`}
									checked={chosen.includes(note.name)}
									onChange={(event) =>
										setChosen((list) =>
											event.target.checked ? [...list, note.name] : list.filter((n) => n !== note.name),
										)
									}
								/>
								<button
									type="button"
									className="kb-memory__open"
									aria-expanded={open === note.name}
									onClick={() => setOpen(open === note.name ? undefined : note.name)}
								>
									<span className="kb-memory__description">{note.description}</span>
									<span className="kb-memory__meta">
										{note.type}
										{note.outside && " · from outside text"}
										{noteAge(note.updatedAt) && ` · ${noteAge(note.updatedAt)}, check before relying on it`}
									</span>
								</button>
								<button
									type="button"
									className="kb-hover-actions__button"
									aria-label={`Download ${note.name}`}
									onClick={() => download(note)}
								>
									<Download size={14} />
								</button>
								<button
									type="button"
									className="kb-hover-actions__button"
									aria-label={`Delete ${note.name}`}
									onClick={() =>
										void store.api.deleteNote({ botId: bot.id, name: note.name }).then(() => store.reload(key))
									}
								>
									<Trash2 size={14} />
								</button>
							</div>
							{open === note.name && <p className="kb-memory__body">{note.body}</p>}
						</li>
					))}
				</ul>
			</section>
			<section className="kb-memory__section" aria-labelledby="memory-open-work">
				<h3 id="memory-open-work" className="kb-memory__title">
					Open work
				</h3>
				<OpenWork bot={bot} />
			</section>
			<section className="kb-memory__section" aria-labelledby="memory-shared">
				<h3 id="memory-shared" className="kb-memory__title">
					Shared with all my bots
				</h3>
				{shared?.summary && <p className="kb-memory__summary">{shared.summary}</p>}
				<ul className="kb-memory__list">
					{(shared?.notes ?? []).map((note) => (
						<li key={note.name} className="kb-memory__note">
							<span className="kb-memory__description">{note.description}</span>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}

function download(note: Note): void {
	const text = `---\nname: ${note.name}\ndescription: ${note.description}\ntype: ${note.type}\n---\n\n${note.body}\n`;
	const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
	const link = document.createElement("a");
	link.download = `${note.name}.md`;
	link.href = url;
	link.click();
	URL.revokeObjectURL(url);
}
