// Mail to a bot's own address (spec sections 10 and 12): received through Cloudflare Email Routing, optionally filtered
// by sender. By default only mail that passes SPF or DKIM fires a routine; the receiving server's
// Authentication-Results header says which passed.
import type { Trigger } from "@knightcode/bots-protocol";
import { asOutsideText, type TriggerAdapter, type TriggerEvent } from "./triggers.ts";

/** The parts of an inbound message a trigger needs (Email Routing's ForwardableEmailMessage has them). */
export interface InboundMail {
	from: string;
	to: string;
	headers: Headers;
	/** The message text (the plain part, or the raw message when there is none). */
	text: string;
}

/** Whether SPF or DKIM passed, from Authentication-Results. */
export function authenticated(headers: Headers): boolean {
	const results = headers.get("authentication-results") ?? "";
	return /\bspf=pass\b/i.test(results) || /\bdkim=pass\b/i.test(results);
}

/** The address part of "Name <a@b.c>". */
export const addressOf = (value: string) => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();

export function mailEvent(mail: InboundMail): TriggerEvent {
	const subject = mail.headers.get("subject") ?? "(no subject)";
	const from = addressOf(mail.from);
	return {
		kind: "email",
		routeKey: addressOf(mail.to),
		title: `Email from ${from}: ${subject}`.slice(0, 200),
		text: asOutsideText(`an email from ${from}`, `From: ${from}\nSubject: ${subject}\n\n${mail.text}`),
		fields: { from, subject },
		...(authenticated(mail.headers) ? {} : { unauthenticated: true }),
	};
}

export const emailAdapter: TriggerAdapter<"email"> = {
	kind: "email",
	// Mail arrives through the Worker's email handler, not over HTTP.
	async verify() {
		return undefined;
	},
	matches(trigger: Extract<Trigger, { kind: "email" }>, event) {
		if (event.unauthenticated && !trigger.allowUnauthenticated) return false;
		if (trigger.from && addressOf(trigger.from) !== event.fields.from && !event.fields.from?.endsWith(`@${trigger.from.replace(/^@/, "")}`))
			return false;
		return true;
	},
};
