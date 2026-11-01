// "Messaged <bot>" and "Message from <bot>" rows; opening one shows the exchange between the bots, read-only.
import type { Bot, Entry } from "@knightcode/bots-protocol";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../primitives/Dialog.tsx";
import { useResource } from "../state/store.ts";
import { formatTime } from "./layout.ts";

type BotMessageEntry = Extract<Entry, { kind: "bot-message" }>;

/** The row and, when opened, the exchange. */
export function BotMessageRow({
	entry,
	botId,
	bots,
}: {
	entry: BotMessageEntry;
	botId: string;
	bots: ReadonlyMap<string, Bot>;
}) {
	const [open, setOpen] = useState(false);
	const peer = bots.get(entry.peerBotId)?.name ?? "a bot";
	const Icon = entry.direction === "to" ? ArrowUpRight : ArrowDownLeft;
	return (
		<>
			<button type="button" className="kb-bot-row" onClick={() => setOpen(true)}>
				<Icon size={14} />
				{entry.direction === "to" ? `Messaged ${peer}` : `Message from ${peer}`}
			</button>
			{open && <Exchange entry={entry} botId={botId} bots={bots} onClose={() => setOpen(false)} />}
		</>
	);
}

function Exchange({
	entry,
	botId,
	bots,
	onClose,
}: {
	entry: BotMessageEntry;
	botId: string;
	bots: ReadonlyMap<string, Bot>;
	onClose: () => void;
}) {
	const { data } = useResource(`exchange:${botId}:${entry.id}`, (api) => api.getExchange({ botId, entryId: entry.id }));
	const peer = bots.get(entry.peerBotId)?.name ?? "the other bot";
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()} title={`With ${peer}`} width={560}>
			<div className="kb-dialog__body kb-exchange">
				{(data?.messages ?? []).map((message, i) => (
					<div key={i} className="kb-exchange__message">
						<div className="kb-exchange__meta">
							{bots.get(message.from)?.name ?? message.from} · {message.intent} · {formatTime(message.createdAt)}
						</div>
						<div className="kb-exchange__text">{message.text}</div>
					</div>
				))}
				<p className="kb-exchange__note">Bots write this exchange themselves. It is shown here for you to read.</p>
			</div>
		</Dialog>
	);
}
