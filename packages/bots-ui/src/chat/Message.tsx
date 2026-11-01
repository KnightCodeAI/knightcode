// One transcript row: a message bubble, a card, a bot-to-bot row, a passed group turn or an event.
import type { Bot, Entry } from "@knightcode/bots-protocol";
import { formatTime, type Place } from "./layout.ts";
import { Markdown } from "./rich/Markdown.tsx";
import { CardView, type CardActions } from "./cards/CardView.tsx";

export interface MessageProps {
	entry: Entry;
	place: Place;
	/** Bots by id, for names in group chats and bot-to-bot rows. */
	bots: ReadonlyMap<string, Bot>;
	/** The bot this thread belongs to, or undefined in a group chat. */
	botName?: string;
	actions: CardActions;
}

const BUBBLE_PLACE: Record<Place, string> = {
	single: "",
	first: " kb-bubble--first",
	middle: " kb-bubble--middle",
	last: " kb-bubble--last",
};

/** Renders one entry as its row. */
export function Message({ entry, place, bots, botName, actions }: MessageProps) {
	const time = (
		<time
			className="kb-time"
			dateTime={new Date(entry.createdAt).toISOString()}
			aria-label={formatTime(entry.createdAt)}
		>
			{formatTime(entry.createdAt)}
		</time>
	);
	switch (entry.kind) {
		case "message": {
			const speaker = entry.botId ? bots.get(entry.botId)?.name : undefined;
			const isUser = entry.role === "user";
			return (
				<div className={`kb-entry${isUser ? " kb-entry--user" : ""}`} role="article" data-entry={entry.id}>
					<div
						className={`kb-bubble${BUBBLE_PLACE[place]}`}
						data-ref="message"
						data-streaming={entry.streaming ? "" : undefined}
					>
						<span className="kb-visually-hidden">{isUser ? "You" : (speaker ?? botName ?? "Bot")}</span>
						{speaker && place !== "middle" && place !== "last" && <span className="kb-speaker">{speaker}</span>}
						<Markdown className="kb-prose" text={entry.text} />
						{entry.streaming && (
							<span data-testid="streaming" className="kb-visually-hidden">
								Replying
							</span>
						)}
					</div>
					{time}
				</div>
			);
		}
		case "card":
			return (
				<div className="kb-entry kb-entry--card" data-entry={entry.id}>
					<CardView entry={entry} actions={actions} />
					{time}
				</div>
			);
		case "bot-message": {
			const peer = bots.get(entry.peerBotId)?.name ?? "a bot";
			return (
				<div className="kb-entry" data-entry={entry.id}>
					<button type="button" className="kb-bot-row" onClick={() => actions.openExchange(entry.id)}>
						{entry.direction === "to" ? `Messaged ${peer}` : `Message from ${peer}`}
					</button>
					{time}
				</div>
			);
		}
		case "turn":
			return (
				<div
					className="kb-entry"
					data-entry={entry.id}
					data-testid={entry.outcome === "pass" ? "turn-passed" : undefined}
				>
					<div className="kb-event">
						<span className="kb-event__label">
							{bots.get(entry.botId)?.name ?? "A bot"}{" "}
							{entry.outcome === "pass" ? "had nothing to add" : "ran out of time"}
						</span>
					</div>
				</div>
			);
		case "event":
			return (
				<div className="kb-entry" data-entry={entry.id}>
					<div className="kb-event" data-ref="system-event">
						<span className="kb-event__label" data-ref="system-event-label">
							{entry.text}
						</span>
					</div>
					{time}
				</div>
			);
	}
}
