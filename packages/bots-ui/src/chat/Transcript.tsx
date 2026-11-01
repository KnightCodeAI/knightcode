// A thread's transcript: day stamps and rows, scrolled to the latest entry as it grows.
import type { Bot, ConversationView } from "@knightcode/bots-protocol";
import { useLayoutEffect, useMemo, useRef } from "react";
import { ErrorBoundary } from "../primitives/ErrorBoundary.tsx";
import { formatDay, layoutEntries } from "./layout.ts";
import { type ChatActions, Message } from "./Message.tsx";

export interface TranscriptProps {
	view: ConversationView | undefined;
	bots: ReadonlyMap<string, Bot>;
	botId?: string;
	botName?: string;
	actions: ChatActions;
	/** An entry to open at (from an inbox, catch-up or search link): scrolled to the middle and highlighted once. */
	focus?: string | null;
}

/**
 * Whether a reader was at the bottom of the content as it was before an update (within 40 px), so the update should
 * keep them there. Measured at the update, so a scroll the browser has not yet reported cannot be overridden.
 */
export function stayPinned(previousScrollHeight: number, scrollTop: number, clientHeight: number): boolean {
	return previousScrollHeight - scrollTop - clientHeight < 40;
}

/** The scrolling transcript. Stays pinned to the bottom unless the reader scrolled up. */
export function Transcript({ view, bots, botId, botName, actions, focus }: TranscriptProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	const previousHeight = useRef(0);
	const focused = useRef<string | null | undefined>(undefined);
	const rows = useMemo(() => layoutEntries(view?.entries ?? []), [view?.entries]);
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		if (focus && focused.current !== focus) {
			const target = el.querySelector(`[data-entry="${CSS.escape(focus)}"]`);
			if (target) {
				focused.current = focus;
				pinned.current = false;
				target.setAttribute("data-highlighted", "");
				target.scrollIntoView({ block: "center" });
				previousHeight.current = el.scrollHeight;
				return;
			}
		}
		// The first view lands at the bottom; later ones follow only a reader who was at the bottom of the old content.
		if (previousHeight.current > 0) pinned.current = stayPinned(previousHeight.current, el.scrollTop, el.clientHeight);
		if (pinned.current) el.scrollTop = el.scrollHeight;
		previousHeight.current = el.scrollHeight;
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
						<ErrorBoundary
							key={row.key}
							fallback={<p className="kb-entry kb-settings__hint">This message could not be shown.</p>}
						>
							<Message
								entry={row.entry}
								place={row.place}
								bots={bots}
								botId={botId}
								botName={botName}
								actions={actions}
							/>
						</ErrorBoundary>
					),
				)}
			</div>
		</div>
	);
}
