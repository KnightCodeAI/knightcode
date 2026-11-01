// Reference documents attached to a bot (a brand guide, a price list): listed in its context by name, read when relevant.
import type { Bot } from "@knightcode/bots-protocol";
import { FileText, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { useResource, useStore } from "../state/store.ts";

/** The list, an add button, and remove on each file. */
export function KnowledgeFiles({ bot }: { bot: Bot }) {
	const store = useStore();
	const key = `files:${bot.id}:knowledge`;
	const { data } = useResource(key, (api) => api.listFiles({ botId: bot.id, kind: "knowledge" }));
	const input = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const add = async (files: FileList | null) => {
		if (!files?.length) return;
		setBusy(true);
		try {
			for (const file of Array.from(files))
				await store.api.uploadFile({
					name: file.name,
					mime: file.type || "application/octet-stream",
					kind: "knowledge",
					botId: bot.id,
					data: await toBase64(file),
				});
			store.reload(key);
		} finally {
			setBusy(false);
		}
	};
	const files = data?.files ?? [];
	return (
		<div className="kb-knowledge">
			{files.length > 0 && (
				<ul className="kb-knowledge__list" aria-label="Knowledge files">
					{files.map((file) => (
						<li key={file.id} className="kb-knowledge__item">
							<FileText size={14} />
							<span className="kb-knowledge__name">{file.name}</span>
							<button
								type="button"
								className="kb-chip__remove"
								aria-label={`Remove ${file.name}`}
								onClick={() => void store.api.deleteFile({ id: file.id }).then(() => store.reload(key))}
							>
								<X size={12} />
							</button>
						</li>
					))}
				</ul>
			)}
			<Button variant="subtle" size="sm" disabled={busy} onClick={() => input.current?.click()}>
				<Plus size={14} /> Add files
			</Button>
			<input
				ref={input}
				type="file"
				multiple
				hidden
				onChange={(event) => void add(event.target.files).then(() => (event.target.value = ""))}
			/>
		</div>
	);
}

async function toBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
