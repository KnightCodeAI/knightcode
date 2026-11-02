// Standing grants (spec section 24): what a routine may do when outside text starts or enters its run. Only the owner
// sets one; outside text never creates or widens it.
import type { Grant } from "@knightcode/bots-protocol";
import type { ActionIntent } from "./actions.ts";

/** A target pattern: exact, or a prefix ending in "*" ("owner/*"). */
const matches = (pattern: string, target: string) =>
	pattern.endsWith("*") ? target.startsWith(pattern.slice(0, -1)) : pattern === target;

/** Whether `intent` fits the grant's actions, targets and limits, given what was already used today and in this run. */
export function withinGrant(grant: Grant, intent: ActionIntent, used: { day: number; run: number } = { day: 0, run: 0 }): boolean {
	if (!grant.actions.includes(intent.tool)) return false;
	if (intent.target === undefined || !grant.targets.some((pattern) => matches(pattern, intent.target!))) return false;
	if (grant.limits.perDay !== undefined && used.day >= grant.limits.perDay) return false;
	if (grant.limits.perRun !== undefined && used.run >= grant.limits.perRun) return false;
	return true;
}
