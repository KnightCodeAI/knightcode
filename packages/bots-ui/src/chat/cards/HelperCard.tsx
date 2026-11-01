// A short-lived helper the bot started for parallel work: Running, Completed or Failed, with its result.
import type { Card } from "@knightcode/bots-protocol";
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { Markdown } from "../rich/Markdown.tsx";

type HelperData = Extract<Card, { type: "helper" }>;

const LABEL: Record<HelperData["state"], string> = { running: "Running", completed: "Completed", failed: "Failed" };

/** One helper's card. */
export function HelperCard({ card }: { card: HelperData }) {
	const Icon = card.state === "running" ? LoaderCircle : card.state === "completed" ? CircleCheck : CircleX;
	return (
		<div className="kb-msg-card" role="group" aria-label={`Helper: ${card.title}`}>
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className={`kb-helper-icon kb-helper-icon--${card.state}`} aria-hidden>
						<Icon size={18} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">{card.title}</p>
						<div className="kb-connect-card__description">{LABEL[card.state]}</div>
					</div>
				</div>
				{card.result && <Markdown className="kb-prose kb-card-body" text={card.result} />}
			</section>
		</div>
	);
}
