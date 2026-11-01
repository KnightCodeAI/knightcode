// A small card for the first link in a reply, fetched server-side (the browser never loads the page).
import { useResource } from "../state/store.ts";

/** The first http(s) link in `text`, if any. */
export function firstLink(text: string): string | undefined {
	return /https?:\/\/[^\s)<>\]]+/.exec(text)?.[0];
}

/** Title, site and description; nothing until the preview arrives. */
export function LinkPreview({ url }: { url: string }) {
	const { data } = useResource(`link:${url}`, (api) => api.linkPreview({ url }));
	if (!data?.title) return null;
	return (
		<a className="kb-link-preview" href={url} target="_blank" rel="noreferrer noopener">
			{data.site && <span className="kb-link-preview__site">{data.site}</span>}
			<span className="kb-link-preview__title">{data.title}</span>
			{data.description && <span className="kb-link-preview__description">{data.description}</span>}
		</a>
	);
}
