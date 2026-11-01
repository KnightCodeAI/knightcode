// A thread's transcript: day stamps and rows, scrolled to the latest entry as it grows.
import type { Bot, ConversationView } from "@knightcode/bots-protocol";
import { useLayoutEffect, useMemo, useRef } from "react";
import { formatDay, layoutEntries } from "./layout.ts";
import { type ChatActions, Message } from "./Message.tsx";

export interface TranscriptProps {
	view: ConversationView | undefined;
	bots: ReadonlyMap<string, Bot>;
	botId?: string;
	botName?: string;
	actions: ChatActions;
}

/** The scrolling transcript. Stays pinned to the bottom unless the reader scrolled up. */
export function Transcript({ view, bots, botId, botName, actions }: TranscriptProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	const rows = useMemo(() => layoutEntries(view?.entries ?? []), [view?.entries]);
	useLayoutEffect(() => {
		const el = scroller.current;
		if (el && pinned.current) el.scrollTop = el.scrollHeight;
	}, [view]);
	return (
		<div
			ref={scroller}
			className="kb-transcript"
			role="log"
			aria-label="Conversation transcript"
			data-ref="transcript"
			onScroll={(event) => {
				const el = event.currentTarget;
				pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
			}}
		>
			<div className="kb-transcript__inner">
				{rows.map((row) =>
					row.kind === "day" ? (
						<div key={row.key} className="kb-entry">
							<div className="kb-day">
								<time data-ref="day-stamp" dateTime={new Date(row.at).toISOString()}>
									{formatDay(row.at)}
								</time>
							</div>
						</div>
					) : (
						<Message
							key={row.key}
							entry={row.entry}
							place={row.place}
							bots={bots}
							botId={botId}
							botName={botName}
							actions={actions}
						/>
					),
				)}
			</div>
		</div>
	);
}
