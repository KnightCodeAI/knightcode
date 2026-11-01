// Files in a message, and the preview that opens when one is clicked.
import type { FileRef } from "@knightcode/bots-protocol";
import { Download, FileText, ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { useStore } from "../state/store.ts";

/** A row of file chips; each opens a preview. */
export function FileList({ files }: { files: FileRef[] }) {
	const [open, setOpen] = useState<FileRef>();
	return (
		<div className="kb-files">
			{files.map((file) => (
				<button key={file.id} type="button" className="kb-chip kb-chip--file" onClick={() => setOpen(file)}>
					{file.mime.startsWith("image/") ? <ImageIcon size={12} /> : <FileText size={12} />}
					<span className="kb-chip__label">{file.name}</span>
					<span className="kb-chip__meta">{formatSize(file.size)}</span>
				</button>
			))}
			{open && <FilePreview file={open} onClose={() => setOpen(undefined)} />}
		</div>
	);
}

/** Images and text open inline; anything else offers a download. */
export function FilePreview({ file, onClose }: { file: FileRef; onClose: () => void }) {
	const store = useStore();
	const [url, setUrl] = useState<string>();
	const [text, setText] = useState<string>();
	useEffect(() => {
		let live = true;
		void store.api.getFile({ id: file.id }).then(async (result) => {
			if (!live) return;
			setUrl(result.url);
			if (file.mime.startsWith("text/") || file.mime === "application/json") {
				const body = await fetch(result.url)
					.then((r) => (r.ok ? r.text() : undefined))
					.catch(() => undefined);
				if (live) setText(body);
			}
		});
		return () => {
			live = false;
		};
	}, [store, file]);
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title={file.name}
			width={720}
			footer={
				url && (
					<Button variant="primary" onClick={() => window.open(url, "_blank", "noopener")}>
						<Download size={14} /> Download
					</Button>
				)
			}
		>
			<div className="kb-dialog__body kb-preview">
				{file.mime.startsWith("image/") && url ? (
					<img src={url} alt={file.name} />
				) : text !== undefined ? (
					<pre>{text}</pre>
				) : (
					<p className="kb-pane__empty">No preview for this file.</p>
				)}
			</div>
		</Dialog>
	);
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
