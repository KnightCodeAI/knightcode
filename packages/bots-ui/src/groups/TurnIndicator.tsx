// Who is taking a turn in a group right now: the bots whose replies are streaming.
import type { Bot, ConversationView } from "@knightcode/bots-protocol";

/** "Reviewer is replying", "Reviewer and Social are replying"; nothing when no one is. */
export function turnText(view: ConversationView | undefined, bots: ReadonlyMap<string, Bot>): string | undefined {
	if (!view?.running) return undefined;
	const names = [
		...new Set(
			view.entries
				.filter((e) => e.kind === "message" && e.streaming && e.botId)
				.map((e) => (e.kind === "message" && e.botId ? (bots.get(e.botId)?.name ?? "A bot") : "")),
		),
	];
	if (names.length === 0) return "Waiting for turns…";
	if (names.length === 1) return `${names[0]} is replying…`;
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are replying…`;
}

export function TurnIndicator({ view, bots }: { view: ConversationView | undefined; bots: ReadonlyMap<string, Bot> }) {
	const text = turnText(view, bots);
	return (
		<div className="kb-turns" role="status" aria-live="polite">
			{text && (
				<>
					<span className="kb-typing" aria-hidden>
						<span />
						<span />
						<span />
					</span>
					{text}
				</>
			)}
		</div>
	);
}
