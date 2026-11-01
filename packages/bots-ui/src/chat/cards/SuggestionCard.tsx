// Work the bot noticed and proposes; accepting starts a run the user started, dismissing teaches it to suggest less.
import type { Card } from "@knightcode/bots-protocol";
import { Lightbulb } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";

type SuggestionData = Extract<Card, { type: "suggestion" }>;

/** The suggestion and its two answers. */
export function SuggestionCard({ card, onAnswer }: { card: SuggestionData; onAnswer: (accept: boolean) => void }) {
	return (
		<div className="kb-msg-card" role="group" aria-label="Suggestion" data-ref="card">
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon kb-tool-icon--soft" aria-hidden>
						<Lightbulb size={20} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">{card.text}</p>
						{card.state !== "open" && (
							<div className="kb-connect-card__description">{card.state === "accepted" ? "Started" : "Dismissed"}</div>
						)}
					</div>
				</div>
				{card.state === "open" && (
					<div className="kb-card-actions">
						<Button variant="secondary" onClick={() => onAnswer(false)}>
							Not now
						</Button>
						<Button variant="primary" onClick={() => onAnswer(true)}>
							Do it
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}
