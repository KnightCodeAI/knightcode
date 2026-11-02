// Slack events (spec section 12), through the same Slack app as the channel: a mention, a message containing a
// keyword, an emoji reaction (optionally only the user's own) or any message, in a chosen channel or any the app is in.
// Requests are verified with Slack's signing secret and a five-minute timestamp window.
import type { Trigger } from "@knightcode/bots-protocol";
import { asOutsideText, hmacHex, sameSignature, type TriggerAdapter, type TriggerEvent } from "./triggers.ts";

const WINDOW_SECONDS = 5 * 60;

/** Verifies Slack's v0 signature over the raw body; the body when genuine. */
export async function verifySlack(request: Request, secret: string | undefined, now = Date.now()): Promise<string | undefined> {
	const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
	const signature = request.headers.get("x-slack-signature") ?? "";
	if (!secret || !signature.startsWith("v0=") || !/^\d+$/.test(timestamp)) return undefined;
	if (Math.abs(now / 1000 - Number(timestamp)) > WINDOW_SECONDS) return undefined;
	const body = await request.text();
	return sameSignature(signature.slice(3), await hmacHex(secret, `v0:${timestamp}:${body}`)) ? body : undefined;
}

type SlackBody = {
	type: string;
	challenge?: string;
	team_id?: string;
	authorizations?: { user_id?: string }[];
	event?: { type: string; text?: string; channel?: string; user?: string; reaction?: string; item?: { channel?: string } };
};

export const slackAdapter: TriggerAdapter<"slack"> = {
	kind: "slack",
	async verify(request, env) {
		const raw = await verifySlack(request, env.SLACK_SIGNING_SECRET);
		if (raw === undefined) return undefined;
		const body = JSON.parse(raw) as SlackBody;
		const event = body.event;
		if (body.type !== "event_callback" || !event || !body.team_id) return [];
		const channel = event.channel ?? event.item?.channel ?? "";
		const kind = event.type === "app_mention" ? "mention" : event.type === "reaction_added" ? "reaction" : event.type === "message" ? "message" : undefined;
		if (!kind) return [];
		const result: TriggerEvent = {
			kind: "slack",
			// Routines index by team; a channel filter is checked in `matches`.
			routeKey: body.team_id,
			title: `Slack ${kind} in ${channel}`,
			text: asOutsideText("Slack", [`${kind} by ${event.user ?? "someone"} in ${channel}`, event.text ?? (event.reaction ? `:${event.reaction}:` : "")].join("\n")),
			fields: { type: kind, channel, user: event.user, text: event.text, reaction: event.reaction },
		};
		return result;
	},
	matches(trigger: Extract<Trigger, { kind: "slack" }>, event) {
		const { type, channel, text, reaction, user, owner } = event.fields as Record<string, string | undefined>;
		if (trigger.channel && trigger.channel !== channel) return false;
		switch (trigger.match) {
			case "mention":
				return type === "mention";
			case "keyword":
				return type === "message" && !!trigger.keyword && !!text && text.toLowerCase().includes(trigger.keyword.toLowerCase());
			case "reaction":
				if (type !== "reaction" || (trigger.emoji && trigger.emoji.replace(/:/g, "") !== reaction)) return false;
				return !trigger.ownReactionsOnly || (!!owner && owner === user);
			case "any":
				return type === "message" || type === "mention";
		}
	},
};
