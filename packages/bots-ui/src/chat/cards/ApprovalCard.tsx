// An approval: the exact action, its target and any change, answered once with Allow once, Always allow or Deny.
import type { Approval } from "@knightcode/bots-protocol";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "../../primitives/Button.tsx";

const STATE_LABEL: Record<Approval["state"], string> = {
	pending: "Waiting for you",
	allowed: "Allowed",
	denied: "Denied",
	expired: "Expired",
};

export type ApprovalDecision = "allow" | "always" | "deny";

/** Buttons show only while pending; the card never blocks the chat around it. */
export function ApprovalCard({
	approval,
	onAnswer,
}: {
	approval: Approval;
	onAnswer: (decision: ApprovalDecision) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const answer = async (decision: ApprovalDecision) => {
		setBusy(true);
		try {
			await onAnswer(decision);
		} finally {
			setBusy(false);
		}
	};
	const pending = approval.state === "pending";
	const spend = approval.action.spend;
	return (
		<div className="kb-msg-card" role="group" aria-label={`Approval: ${approval.action.title}`} data-ref="card">
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon kb-tool-icon--soft" aria-hidden>
						<ShieldCheck size={20} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">{approval.action.title}</p>
						<div className="kb-connect-card__description">
							{spend
								? `${formatMoney(spend.amount, spend.currency)} at ${spend.merchant} · ${spend.item}`
								: (approval.action.target ?? approval.action.tool)}
						</div>
					</div>
					{!pending && (
						<span className="kb-card-state" data-testid="approval-state" data-state={approval.state}>
							{STATE_LABEL[approval.state]}
						</span>
					)}
				</div>
				{approval.action.change && (
					<div className="kb-change">
						<div className="kb-change__side">
							<span className="kb-change__label">Before</span>
							<pre className="kb-change__text">{approval.action.change.before}</pre>
						</div>
						<div className="kb-change__side">
							<span className="kb-change__label">After</span>
							<pre className="kb-change__text">{approval.action.change.after}</pre>
						</div>
					</div>
				)}
				{pending && (
					<div className="kb-card-actions">
						<Button variant="secondary" disabled={busy} onClick={() => void answer("deny")}>
							Deny
						</Button>
						<Button variant="secondary" disabled={busy} onClick={() => void answer("always")}>
							Always allow
						</Button>
						<Button variant="primary" disabled={busy} onClick={() => void answer("allow")}>
							Allow once
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}

function formatMoney(amount: number, currency: string): string {
	return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}
