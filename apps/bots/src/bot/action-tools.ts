// Outward actions as tools (spec sections 13 and 24): each one is recorded, then decided by the approval policy (mode,
// allow and block lists, the outside mark and the routine's grant). A refused action stops; one that needs the owner
// becomes an approval card while the bot carries on; one allowed is delivered through its adapter.
import { defineTool } from "@knightcode/durable";
import { obj, str } from "@knightcode/schema";
import type { ActionIntent, ActionState } from "./actions.ts";

export type GateResult =
	| { decision: "refuse"; reason: string }
	| { decision: "ask"; approvalId: string }
	| { decision: "run"; actionId: string; state: ActionState };

export type Gate = (intent: ActionIntent) => Promise<GateResult>;

const text = (value: string, isError = false) => ({ output: [{ type: "text" as const, text: value }], ...(isError ? { isError } : {}) });

/** What the bot is told about its action. */
export function gateMessage(result: GateResult): { text: string; isError: boolean } {
	switch (result.decision) {
		case "refuse":
			return { text: `Not done: ${result.reason}`, isError: true };
		case "ask":
			return {
				text: "Waiting for the owner's approval; a card is shown to them. Carry on with other work; do not try this action another way.",
				isError: false,
			};
		case "run":
			return result.state === "sent" || result.state === "confirmed"
				? { text: "Done.", isError: false }
				: result.state === "unknown"
					? { text: "Sent, but whether it arrived is unknown; it will not be resent. Tell the owner.", isError: true }
					: { text: "Queued for delivery.", isError: false };
	}
}

export function sendEmailTool(gate: Gate) {
	return defineTool({
		name: "send_email",
		description: "Send an email from your own address. The owner's approval rules apply.",
		parameters: obj({ to: str(), subject: str(), body: str() }),
		execute: async (args) => {
			const result = await gate({ tool: "email.send", title: `Email ${args.to}: ${args.subject}`.slice(0, 200), target: args.to, args });
			const message = gateMessage(result);
			return text(message.text, message.isError);
		},
	});
}
