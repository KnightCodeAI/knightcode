// The plan, the trial and top-ups (spec section 16). Credits are cents of cost: a payment converts at cost x 1.1 after
// the actual payment fee, so a $5 top-up never loses money. Placeholders the beta fixes: included computer hours.
import { unitCost } from "../user/balance.ts";

export const PLAN = { priceCents: 1000, trialDays: 3, includedComputerHours: 60, trialComputerHours: 6, storageGb: 10 } as const;
export const TOP_UP_PRESETS = [500, 1500, 2500] as const;
export const MIN_TOP_UP_CENTS = 500;
export const MARKUP = 1.1;

/** Cents of cost a payment buys: what was paid minus the actual fee, at cost x 1.1. */
export const creditsForPayment = (paidCents: number, feeCents: number) => Math.max(0, Math.floor((paidCents - feeCents) / MARKUP));

/** Credits that cover `hours` of computer time (12 five-minute blocks an hour). */
export const computerHoursCredits = (hours: number) => hours * 12 * unitCost("computer");

export type PlanStatus = "none" | "trialing" | "active" | "lapsed";
export type Feature = "sign_in" | "history" | "export" | "chat" | "routines" | "computer" | "bank" | "composio_overage";

/**
 * What a plan status allows. A lapsed plan (cancelled or failed payment) stops routines and every metered extra, but
 * the user can still sign in, read history, export and subscribe again. The trial has no bank links or Composio overage.
 */
export function planAllows(status: PlanStatus, feature: Feature): boolean {
	if (feature === "sign_in" || feature === "history" || feature === "export") return true;
	if (status === "lapsed") return feature === "chat";
	if (status === "trialing") return feature !== "bank" && feature !== "composio_overage";
	return true;
}
