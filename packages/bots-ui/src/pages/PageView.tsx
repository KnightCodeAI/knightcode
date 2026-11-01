// One page: its blocks, its owner and last update, pin, version history with restore, and export as Markdown or PDF.
import type { Page } from "@knightcode/bots-protocol";
import { ChevronLeft, Download, History, Pin, PinOff } from "lucide-react";
import { useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { formatDay, formatTime } from "../chat/layout.ts";
import { IconButton } from "../primitives/IconButton.tsx";
import { Menu, MenuItem } from "../primitives/Menu.tsx";
import { navigate } from "../shell/routes.ts";
import { useBots, useResource, useStore } from "../state/store.ts";
import { BlockView } from "./blocks/BlockView.tsx";

/** The page at /pages/<id>. */
export function PageView({ pageId }: { pageId: string }) {
	const store = useStore();
	const key = `page:${pageId}`;
	const { data: page, error } = useResource(key, (api) => api.getPage({ id: pageId }));
	const { data: bots } = useBots();
	const [version, setVersion] = useState<Page>();
	const { data: versions } = useResource(`page-versions:${pageId}:${page?.version}`, (api) =>
		api.listPageVersions({ id: pageId }),
	);
	if (error) return <PageMissing />;
	if (!page) return <div className="kb-view" />;
	const shown = version ?? page;
	const owner = bots?.bots.find((b) => b.id === page.ownerBotId);
	const save = (patch: { pinned?: boolean }) =>
		void store.api.updatePage({ id: page.id, baseVersion: page.version, ...patch }).then((next) => {
			store.set(key, () => next);
			store.reload("pages");
		});
	const exportAs = async (format: "markdown" | "pdf") => {
		const { fileId } = await store.api.exportPage({ id: page.id, format });
		const { url } = await store.api.getFile({ id: fileId });
		window.open(url, "_blank", "noopener");
	};
	return (
		<div className="kb-view kb-page">
			<div className="kb-view__inner">
				<button type="button" className="kb-browser__back" onClick={() => navigate({ name: "pages" })}>
					<ChevronLeft size={14} /> Pages
				</button>
				<header className="kb-page__head">
					<h1 className="kb-view__title">{shown.title}</h1>
					<div className="kb-page__actions">
						<IconButton
							label={page.pinned ? "Unpin" : "Pin"}
							icon={page.pinned ? <PinOff size={16} /> : <Pin size={16} />}
							onClick={() => save({ pinned: !page.pinned })}
						/>
						<Menu
							label="Versions"
							align="end"
							trigger={<IconButton label="Version history" icon={<History size={16} />} />}
						>
							{(versions?.versions ?? [])
								.slice()
								.sort((a, b) => b.version - a.version)
								.map((v) => (
									<MenuItem
										key={v.version}
										onSelect={() =>
											v.version === page.version
												? setVersion(undefined)
												: void store.api.getPageVersion({ id: page.id, version: String(v.version) }).then(setVersion)
										}
									>
										Version {v.version} · {v.author} · {formatDay(v.updatedAt)}
									</MenuItem>
								))}
						</Menu>
						<Menu label="Export" align="end" trigger={<IconButton label="Export" icon={<Download size={16} />} />}>
							<MenuItem onSelect={() => void exportAs("markdown")}>Export as Markdown</MenuItem>
							<MenuItem onSelect={() => void exportAs("pdf")}>Export as PDF</MenuItem>
						</Menu>
					</div>
				</header>
				<p className="kb-page__meta">
					{owner && (
						<span className="kb-page__owner" data-avatar-box="">
							<BotAvatarView shape={owner.avatar.shape} color={owner.avatar.color} size={16} />
						</span>
					)}
					{owner?.name ?? "A bot"} · Updated {formatDay(page.updatedAt)} {formatTime(page.updatedAt)}
				</p>
				{version && (
					<div className="kb-page__version" role="status">
						Showing version {version.version}.
						<button
							type="button"
							className="kb-link-button"
							onClick={() =>
								void store.api.restorePageVersion({ id: page.id, version: String(version.version) }).then((next) => {
									store.set(key, () => next);
									setVersion(undefined);
								})
							}
						>
							Restore it
						</button>
						<button type="button" className="kb-link-button" onClick={() => setVersion(undefined)}>
							Back to the latest
						</button>
					</div>
				)}
				<div className="kb-page__blocks">
					{shown.blocks.map((block) => (
						<BlockView key={block.id} block={block} pageId={page.id} />
					))}
				</div>
			</div>
		</div>
	);
}

function PageMissing() {
	return (
		<div className="kb-view">
			<div className="kb-view__inner">
				<h1 className="kb-view__title">Nothing here</h1>
				<p className="kb-settings__hint">This page does not exist, or it was deleted.</p>
			</div>
		</div>
	);
}
