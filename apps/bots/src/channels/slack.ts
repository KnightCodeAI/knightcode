// Slack (spec section 10): one distributed Slack app. "Add to Slack" installs it in a workspace (its bot token is kept
// with the account's credentials as "slack:<team>"); "Link DMs" routes the user's direct messages with the app to one
// bot. Requests are verified with the signing secret, as the routine triggers' are.
import type { Env } from "../env.ts";
import { verifySlack } from "../routines/slack-events.ts";
import type { ChannelAdapter, ChannelDelivery, ChannelLink, ChannelOutbound, InboundMessage } from "./contract.ts";

type SlackEventBody = {
	type?: string;
	team_id?: string;
	event?: { type?: string; channel_type?: string; channel?: string; user?: string; text?: string; ts?: string; bot_id?: string; subtype?: string };
};

/** The DMs in an already-verified Slack event body (the trigger endpoint verifies once for both uses). */
export function slackDirectMessages(raw: string): InboundMessage[] {
	const body = JSON.parse(raw) as SlackEventBody;
	const event = body.event;
	// Only people's direct messages: not the app's own posts, edits or joins.
	if (body.type !== "event_callback" || !body.team_id || event?.type !== "message" || event.channel_type !== "im") return [];
	if (event.bot_id || event.subtype || !event.user || !event.text) return [];
	return [
		{
			channel: "slack",
			externalChat: `${body.team_id}:${event.user}`,
			externalUser: event.user,
			text: event.text,
			// The DM channel and the message's timestamp: where and to what a reply goes.
			messageId: `${event.channel}:${event.ts}`,
		},
	];
}

export const slackChannel: ChannelAdapter = {
	id: "slack",
	async verify(request, env) {
		const raw = await verifySlack(request, env.SLACK_SIGNING_SECRET);
		return raw === undefined ? undefined : slackDirectMessages(raw);
	},
	async send(env: Env, link: ChannelLink, message: ChannelOutbound): Promise<ChannelDelivery> {
		const [team] = link.externalChat.split(":");
		const user = env.USER.get(env.USER.idFromName(link.accountId));
		const credential = (await user.credentialRead(`slack:${team}`)) as { type: string; key?: string } | undefined;
		if (!credential?.key) return { ok: false, error: "the Slack app is not installed for this workspace", retryable: false };
		const [channel] = (message.replyTo ?? "").split(":");
		const response = await fetch(`${env.SLACK_API_URL ?? "https://slack.com/api"}/chat.postMessage`, {
			method: "POST",
			headers: { authorization: `Bearer ${credential.key}`, "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({ channel: channel || link.externalChat.split(":")[1], text: message.text }),
		});
		const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string };
		if (!body.ok) return { ok: false, error: `Slack: ${body.error ?? response.status}`, retryable: response.status >= 500 || response.status === 429 };
		return { ok: true, ...(body.ts ? { messageId: body.ts } : {}) };
	},
};
