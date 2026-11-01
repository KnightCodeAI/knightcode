// One transcript row: a message bubble, a card, a bot-to-bot row, a passed group turn or an event.
import type { Bot, Entry } from "@knightcode/bots-protocol";
import { BotMessageRow } from "./BotMessageRow.tsx";
import { type CardActions, CardView } from "./cards/CardView.tsx";
import { FileList } from "./FilePreview.tsx";
import { formatTime, type Place } from "./layout.ts";
import { firstLink, LinkPreview } from "./LinkPreview.tsx";
import { type MessageActionHandlers, MessageActions, Reactions } from "./MessageActions.tsx";
import { Markdown } from "./rich/Markdown.tsx";
import { ToolActivity } from "./ToolActivity.tsx";

export type ChatActions = CardActions & MessageActionHandlers;

export interface MessageProps {
	entry: Entry;
	place: Place;
	/** Bots by id, for names in group chats and bot-to-bot rows. */
	bots: ReadonlyMap<string, Bot>;
	/** The bot whose thread this is, or undefined in a group chat. */
	botId?: string;
	botName?: string;
	actions: ChatActions;
}

const BUBBLE_PLACE: Record<Place, string> = {
	single: "",
	first: " kb-bubble--first",
	middle: " kb-bubble--middle",
	last: " kb-bubble--last",
};

/** Renders one entry as its row. */
export function Message({ entry, place, bots, botId, botName, actions }: MessageProps) {
	const time = (
		<time
			className="kb-time"
			data-ref="row-time"
			dateTime={new Date(entry.createdAt).toISOString()}
			aria-label={formatTime(entry.createdAt)}
		>
			{formatTime(entry.createdAt)}
		</time>
	);
	switch (entry.kind) {
		case "message": {
			const speakerName = entry.botId ? bots.get(entry.botId)?.name : undefined;
			const isUser = entry.role === "user";
			const speaker = isUser ? "your" : (speakerName ?? botName ?? "bot");
			const link = isUser || entry.streaming ? undefined : firstLink(entry.text);
			return (
				<div
					className={`kb-entry kb-entry--message${isUser ? " kb-entry--user" : ""}`}
					role="article"
					data-ref="row"
					data-entry={entry.id}
				>
					<div className="kb-bubble-row">
						<div
							className={`kb-bubble${BUBBLE_PLACE[place]}`}
							data-ref="message"
							data-streaming={entry.streaming ? "" : undefined}
						>
							<span className="kb-visually-hidden">{isUser ? "You" : (speakerName ?? botName ?? "Bot")}</span>
							{speakerName && place !== "middle" && place !== "last" && (
								<span className="kb-speaker">{speakerName}</span>
							)}
							{entry.quote && <blockquote className="kb-bubble__quote">{entry.quote}</blockquote>}
							<Markdown className="kb-prose" text={entry.text} />
							{entry.streaming && (
								<span data-testid="streaming" className="kb-typing" aria-label="Replying">
									<span />
									<span />
									<span />
								</span>
							)}
						</div>
						{!entry.streaming && <MessageActions entry={entry} speaker={speaker} handlers={actions} />}
					</div>
					{entry.attachments && entry.attachments.length > 0 && <FileList files={entry.attachments} />}
					{entry.tools && bots.get(entry.botId ?? botId ?? "")?.showTools && <ToolActivity tools={entry.tools} />}
					{link && <LinkPreview url={link} />}
					<Reactions entry={entry} onReact={(emoji) => actions.react(entry.id, emoji)} />
					{time}
				</div>
			);
		}
		case "card":
			return (
				<div className="kb-entry kb-entry--card" data-ref="row" data-entry={entry.id} data-card={entry.card.type}>
					<CardView entry={entry} actions={actions} />
					{time}
				</div>
			);
		case "bot-message":
			return (
				<div className="kb-entry" data-ref="row" data-entry={entry.id}>
					<BotMessageRow entry={entry} botId={botId ?? ""} bots={bots} />
					{time}
				</div>
			);
		case "turn":
			return (
				<div
					className="kb-entry"
					data-ref="row"
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
				<div className="kb-entry" data-ref="row" data-entry={entry.id}>
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
