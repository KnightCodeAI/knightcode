// A request from the bot for the user to take control of its screen (to sign in, or solve a check).
import type { Card } from "@knightcode/bots-protocol";
import { MonitorUp } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";

type TakeoverData = Extract<Card, { type: "takeover" }>;

const STATE_LABEL: Record<TakeoverData["state"], string> = {
	requested: "Waiting for you",
	active: "You have control",
	released: "Done",
};

/** Take control opens the bot's screen in control mode. */
export function TakeoverCard({ card, onTakeControl }: { card: TakeoverData; onTakeControl: () => void }) {
	return (
		<div className="kb-msg-card" role="group" aria-label={`Takeover: ${card.reason}`} data-ref="card">
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon kb-tool-icon--soft" aria-hidden>
						<MonitorUp size={20} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">{card.reason}</p>
						<div className="kb-connect-card__description">{STATE_LABEL[card.state]}</div>
					</div>
					{card.state === "requested" && (
						<Button variant="primary" onClick={onTakeControl} data-ref="card-button">
							Take control
						</Button>
					)}
				</div>
			</section>
		</div>
	);
}
