// Picks the component for a card entry. Each card stays answerable while the chat goes on.
import type { Entry } from "@knightcode/bots-protocol";
import { ConnectAppCard } from "./ConnectAppCard.tsx";
import { QuestionCard } from "./QuestionCard.tsx";

/** What cards can do; the chat view wires these to the socket and the API. */
export interface CardActions {
	answer: (entryId: string, value: string) => void;
	connectApp: (appId: string) => void;
	openExchange: (entryId: string) => void;
}

type CardEntry = Extract<Entry, { kind: "card" }>;

/** The card for `entry`, or nothing for card types the next tasks add. */
export function CardView({ entry, actions }: { entry: CardEntry; actions: CardActions }) {
	const card = entry.card;
	switch (card.type) {
		case "question":
			return <QuestionCard card={card} onAnswer={(value) => actions.answer(entry.id, value)} />;
		case "connect-app":
			return <ConnectAppCard card={card} onConnect={() => actions.connectApp(card.appId)} />;
		default:
			return null;
	}
}
