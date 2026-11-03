// The pages library: every page, searchable, pinned ones first, with its owner bot and last update.
import { Pin, Search } from "lucide-react";
import { useState } from "react";
import { BotAvatar } from "../avatar/BotAvatar.tsx";
import { formatDay } from "../chat/layout.ts";
import { navigate } from "../shell/routes.ts";
import { useBots, useResource } from "../state/store.ts";

/** The view at /pages. */
export function PagesLibrary() {
	const [query, setQuery] = useState("");
	const { data } = useResource("pages", (api) => api.listPages({}));
	const { data: bots } = useBots();
	const needle = query.trim().toLowerCase();
	const pages = (data?.pages ?? [])
		.filter((p) => !needle || p.title.toLowerCase().includes(needle))
		.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
	return (
		<div className="kb-view">
			<div className="kb-view__inner">
				<h1 className="kb-view__title">Pages</h1>
				<label className="kb-search-box kb-view__search">
					<Search size={14} className="kb-search-box__icon" aria-hidden />
					<input
						type="search"
						aria-label="Search pages"
						placeholder="Search pages"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</label>
				{pages.length === 0 ? (
					<p className="kb-settings__hint">
						{needle ? `No pages match "${query}".` : "Pages your bots make show up here."}
					</p>
				) : (
					<ul className="kb-list">
						{pages.map((page) => {
							const owner = bots?.bots.find((b) => b.id === page.ownerBotId);
							return (
								<li key={page.id}>
									<a
										className="kb-list__row"
										href={`/pages/${encodeURIComponent(page.id)}`}
										onClick={(event) => {
											event.preventDefault();
											navigate({ name: "page", pageId: page.id });
										}}
									>
										{owner && (
											<span className="kb-list__avatar" data-avatar-box="">
												<BotAvatar bot={owner} size={24} />
											</span>
										)}
										<span className="kb-list__main">
											<span className="kb-list__title">{page.title}</span>
											<span className="kb-list__meta">
												{owner?.name ?? "A bot"} · Updated {formatDay(page.updatedAt)}
											</span>
										</span>
										{page.pinned && <Pin size={14} className="kb-list__pin" aria-label="Pinned" />}
									</a>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
