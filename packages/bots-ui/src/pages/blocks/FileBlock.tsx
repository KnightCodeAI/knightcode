// An embedded file: a chip that opens the preview.
import type { PageBlock } from "@knightcode/bots-protocol";
import { FileText } from "lucide-react";
import { useState } from "react";
import { FilePreview } from "../../chat/FilePreview.tsx";

export function FileBlock({ block }: { block: Extract<PageBlock, { type: "file" }> }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" className="kb-chip kb-chip--file" onClick={() => setOpen(true)}>
				<FileText size={12} />
				<span className="kb-chip__label">{block.name}</span>
			</button>
			{open && (
				<FilePreview
					file={{
						id: block.fileId,
						name: block.name,
						size: 0,
						mime: guessMime(block.name),
						kind: "bot-output",
						createdAt: 0,
					}}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}

function guessMime(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase();
	if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp")
		return `image/${ext === "jpg" ? "jpeg" : ext}`;
	if (ext === "md" || ext === "txt" || ext === "csv") return "text/plain";
	if (ext === "json") return "application/json";
	return "application/octet-stream";
}
