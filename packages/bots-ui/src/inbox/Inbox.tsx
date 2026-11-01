// The inbox: one list across every bot of what waits on the user (approvals, questions, takeovers, results to review,
// failed runs, suggestions), grouped by bot in sidebar order with pinned items on top, then tasks.
import type { Bot, InboxItem } from "@knightcode/bots-protocol";
import { Check, Circle, Pin, PinOff } from "lucide-react";
import { useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { formatDay, formatTime } from "../chat/layout.ts";
import { Chips } from "../connectors/Catalog.tsx";
import { navigate } from "../shell/routes.ts";
import { INBOX, useBots, useResource, useStore } from "../state/store.ts";
import { TaskList } from "./TaskList.tsx";

export const KIND_LABELS: Record<InboxItem["kind"], string> = {
	approval: "Approval",
	question: "Question",
	takeover: "Take control",
	review: "To review",
	failure: "Failed",
	task: "Task",
	suggestion: "Suggestion",
};

type Filter = "open" | "unread" | "done";

/** Pinned items first, then each bot's items in sidebar order, newest first within a bot. */
export function groupInbox(
	items: InboxItem[],
	bots: Bot[],
	filter: Filter,
): { key: string; title: string; bot?: Bot; items: InboxItem[] }[] {
	const shown = items.filter((i) => (filter === "done" ? i.done : !i.done && (filter === "open" || !i.read)));
	const newest = (a: InboxItem, b: InboxItem) => b.createdAt - a.createdAt;
	const pinned = shown.filter((i) => i.pinned).sort(newest);
	const groups = bots
		.map((bot) => ({
			key: bot.id,
			title: bot.name,
			bot,
			items: shown.filter((i) => !i.pinned && i.botId === bot.id).sort(newest),
		}))
		.filter((g) => g.items.length > 0);
	return [...(pinned.length ? [{ key: "pinned", title: "Pinned", items: pinned }] : []), ...groups];
}

/** The view at /inbox. */
export function Inbox() {
	const store = useStore();
	const { data } = useResource(INBOX, (api) => api.listInbox({}));
	const { data: bots } = useBots();
	const [filter, setFilter] = useState<Filter>("open");
	const groups = groupInbox(data?.items ?? [], bots?.bots ?? [], filter);
	const update = (item: InboxItem, patch: Partial<Pick<InboxItem, "pinned" | "done" | "read">>) =>
		void store.api.updateInboxItem({ id: item.id, ...patch }).then(() => store.reload(INBOX));
	const open = (item: InboxItem) => {
		if (!item.read) update(item, { read: true });
		navigate(
			item.entryId
				? `/bots/${encodeURIComponent(item.botId)}?entry=${encodeURIComponent(item.entryId)}`
				: { name: "bot", botId: item.botId, pane: "details" },
		);
	};
	return (
		<div className="kb-view">
			<div className="kb-view__inner">
				<h1 className="kb-view__title">Inbox</h1>
				<Chips
					label="Show"
					value={filter}
					onChange={(next) => setFilter(next as Filter)}
					items={[
						{ value: "open", label: "Waiting" },
						{ value: "unread", label: "Unread" },
						{ value: "done", label: "Done" },
					]}
				/>
				{groups.length === 0 && (
					<p className="kb-settings__hint">{filter === "done" ? "Nothing done yet." : "Nothing is waiting on you."}</p>
				)}
				{groups.map((group) => (
					<section key={group.key} className="kb-inbox__group" aria-label={group.title}>
						<h2 className="kb-inbox__group-title">
							{group.bot && (
								<span className="kb-inbox__avatar" data-avatar-box="">
									<BotAvatarView shape={group.bot.avatar.shape} color={group.bot.avatar.color} size={18} />
								</span>
							)}
							{group.title}
						</h2>
						<ul className="kb-list">
							{group.items.map((item) => {
								const bot = bots?.bots.find((b) => b.id === item.botId);
								return (
									<li key={item.id} className="kb-inbox__item" data-unread={item.read ? undefined : ""}>
										<button type="button" className="kb-list__row" onClick={() => open(item)}>
											{!item.read && <span className="kb-inbox__dot" aria-label="Unread" />}
											<span className="kb-list__main">
												<span className="kb-list__title">{item.title}</span>
												<span className="kb-list__meta">
													{bot?.name ?? "A bot"} · {KIND_LABELS[item.kind]} · {formatDay(item.createdAt)}{" "}
													{formatTime(item.createdAt)}
													{item.detail ? ` · ${item.detail}` : ""}
												</span>
											</span>
										</button>
										<div className="kb-inbox__actions">
											<button
												type="button"
												className="kb-hover-actions__button"
												aria-label={item.pinned ? "Unpin" : "Pin"}
												onClick={() => update(item, { pinned: !item.pinned })}
											>
												{item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
											</button>
											<button
												type="button"
												className="kb-hover-actions__button"
												aria-label={item.read ? "Mark unread" : "Mark read"}
												onClick={() => update(item, { read: !item.read })}
											>
												<Circle size={12} />
											</button>
											{!item.done && (
												<button
													type="button"
													className="kb-hover-actions__button"
													aria-label="Mark done"
													onClick={() => update(item, { done: true })}
												>
													<Check size={14} />
												</button>
											)}
										</div>
									</li>
								);
							})}
						</ul>
					</section>
				))}
				<TaskList tasks={data?.tasks ?? []} bots={bots?.bots ?? []} />
			</div>
		</div>
	);
}
