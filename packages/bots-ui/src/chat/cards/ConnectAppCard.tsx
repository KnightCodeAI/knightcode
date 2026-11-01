// An offer to connect an app: its tile, name and a one-line reason, with Connect, and a footnote under the card.
import type { Card } from "@knightcode/bots-protocol";
import { BadgeCheck } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";

type ConnectAppData = Extract<Card, { type: "connect-app" }>;

/** The connect card; the app's tile shows its initial. */
export function ConnectAppCard({ card, onConnect }: { card: ConnectAppData; onConnect: () => void }) {
	return (
		<div className="kb-msg-card" role="group" aria-label={`Connect ${card.name}`} data-ref="connector-card">
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon" aria-hidden>
						{card.name.slice(0, 1)}
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">
							{card.name}
							{card.verified && (
								<span className="kb-connect-card__verified" role="img" aria-label="Official">
									<BadgeCheck size={16} fill="currentColor" color="var(--kb-color-surface)" strokeWidth={2} />
								</span>
							)}
						</p>
						<div className="kb-connect-card__description">{card.description}</div>
					</div>
					<Button variant="primary" onClick={onConnect} data-ref="connector-card-button">
						Connect
					</Button>
				</div>
			</section>
			{card.footnote && <p className="kb-msg-card__footnote">{card.footnote}</p>}
		</div>
	);
}
