// Stripe webhooks (spec section 16): the signature is checked before anything is read; each event becomes an
// idempotent billing change on the account's user object. Credits are keyed by the payment or invoice, so a replayed
// event never adds them twice; refunds reduce the balance once per refund.
import { hmacHex, sameSignature } from "../routines/triggers.ts";
import { computerHoursCredits, creditsForPayment, PLAN, type PlanStatus } from "./plans.ts";

const TOLERANCE_S = 300;

/** Whether `header` (Stripe-Signature) signs `body` with `secret`, within five minutes of `now`. */
export async function verifyStripeSignature(secret: string, header: string | null, body: string, now = Date.now()): Promise<boolean> {
	if (!header) return false;
	const parts = header.split(",").map((part) => part.split("=", 2) as [string, string]);
	const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
	if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > TOLERANCE_S) return false;
	const expected = await hmacHex(secret, `${timestamp}.${body}`);
	return parts.some(([key, value]) => key === "v1" && sameSignature(value, expected));
}

export type BillingChange =
	| { type: "grant"; cents: number; key: string }
	/** A charge's refunds so far (Stripe reports the cumulative amount); only what is new comes off. */
	| { type: "refund"; chargeId: string; refundedTotal: number }
	/** `at` is the event's time: an older event never overrides a newer plan state. */
	| { type: "plan"; status: PlanStatus; at: number }
	| { type: "customer"; id: string };

type StripeObject = Record<string, unknown> & { id: string; metadata?: Record<string, string> };
export type StripeEvent = { id: string; type: string; created?: number; data: { object: StripeObject } };

const accountOf = (object: StripeObject): string | undefined => {
	const details = (object.subscription_details ?? (object.parent as { subscription_details?: unknown } | undefined)?.subscription_details) as
		| { metadata?: Record<string, string> }
		| undefined;
	return object.metadata?.account ?? details?.metadata?.account;
};

const planStatus = (status: unknown): PlanStatus =>
	status === "trialing" ? "trialing" : status === "active" ? "active" : status === "canceled" || status === "unpaid" || status === "past_due" || status === "incomplete_expired" ? "lapsed" : "none";

/** The account and the changes one event makes; nothing for events billing ignores. */
export async function billingChanges(
	event: StripeEvent,
	deps: { fee(paymentIntentId: string): Promise<number> },
): Promise<{ accountId: string; changes: BillingChange[] } | undefined> {
	const object = event.data.object;
	const accountId = accountOf(object);
	const at = event.created !== undefined ? event.created * 1000 : Date.now();
	if (!accountId) return undefined;
	switch (event.type) {
		case "checkout.session.completed": {
			if (object.metadata?.kind !== "topup" || object.payment_status !== "paid") return undefined;
			const intent = String(object.payment_intent);
			const cents = creditsForPayment(Number(object.amount_total), await deps.fee(intent));
			return { accountId, changes: cents > 0 ? [{ type: "grant", cents, key: `topup:${intent}` }] : [] };
		}
		case "customer.subscription.created":
		case "customer.subscription.updated": {
			const status = planStatus(object.status);
			const changes: BillingChange[] = [{ type: "plan", status, at }, ...(typeof object.customer === "string" ? [{ type: "customer" as const, id: object.customer }] : [])];
			// The trial's capped computer time, once per subscription.
			if (status === "trialing") changes.push({ type: "grant", cents: computerHoursCredits(PLAN.trialComputerHours), key: `trial:${object.id}` });
			return { accountId, changes };
		}
		case "customer.subscription.deleted":
			return { accountId, changes: [{ type: "plan", status: "lapsed", at }] };
		case "invoice.paid":
			// A paid period: the plan's included computer hours, once per invoice. The trial's $0 invoice adds nothing.
			if (Number(object.amount_paid) <= 0) return undefined;
			return { accountId, changes: [{ type: "plan", status: "active", at }, { type: "grant", cents: computerHoursCredits(PLAN.includedComputerHours), key: `invoice:${object.id}` }] };
		case "invoice.payment_failed":
			return { accountId, changes: [{ type: "plan", status: "lapsed", at }] };
		case "charge.refunded":
			return { accountId, changes: [{ type: "refund", chargeId: object.id, refundedTotal: Number(object.amount_refunded) || 0 }] };
		default:
			return undefined;
	}
}
