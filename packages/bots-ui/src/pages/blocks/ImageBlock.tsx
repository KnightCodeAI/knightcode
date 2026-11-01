// An image from the user's file store, by file id; the page holds no URL of its own.
import type { PageBlock } from "@knightcode/bots-protocol";
import { useResource } from "../../state/store.ts";

export function ImageBlock({ block }: { block: Extract<PageBlock, { type: "image" }> }) {
	const { data } = useResource(`file:${block.fileId}`, (api) => api.getFile({ id: block.fileId }));
	return (
		<figure className="kb-page-image">
			{data?.url ? (
				<img src={data.url} alt={block.alt} loading="lazy" />
			) : (
				<div className="kb-page-image__placeholder" role="img" aria-label={block.alt} />
			)}
		</figure>
	);
}
