// Events from apps connected through Composio (spec section 12), such as "new email" in the user's own Gmail.
// Composio posts them to our webhook signed with the project's webhook secret; the connected account says whose they are.
import type { Trigger } from "@knightcode/bots-protocol";
import { asOutsideText, hmacHex, sameSignature, type TriggerAdapter, type TriggerEvent } from "./triggers.ts";

type ComposioEvent = { type?: string; data?: { toolkit?: string; trigger_slug?: string; connected_account_id?: string; payload?: unknown } };

export const composioAdapter: TriggerAdapter<"composio"> = {
	kind: "composio",
	async verify(request, env) {
		const secret = env.COMPOSIO_WEBHOOK_SECRET;
		const id = request.headers.get("webhook-id") ?? "";
		const timestamp = request.headers.get("webhook-timestamp") ?? "";
		const signature = request.headers.get("webhook-signature") ?? "";
		if (!secret || !id || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return undefined;
		const raw = await request.text();
		// Standard Webhooks signing: base64 HMAC-SHA256 of "id.timestamp.body", "v1,<signature>", possibly several.
		const hex = await hmacHex(secret, `${id}.${timestamp}.${raw}`);
		const expected = btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16))));
		if (!signature.split(" ").some((part) => sameSignature(part.replace(/^v1,/, ""), expected))) return undefined;
		const body = JSON.parse(raw) as ComposioEvent;
		const account = body.data?.connected_account_id;
		const app = body.data?.toolkit?.toLowerCase();
		const event = body.data?.trigger_slug;
		if (!account || !app || !event) return [];
		const result: TriggerEvent = {
			kind: "composio",
			routeKey: account,
			title: `${app}: ${event}`,
			text: asOutsideText(app, JSON.stringify(body.data?.payload ?? {}, null, 2)),
			fields: { app, event },
		};
		return result;
	},
	matches(trigger: Extract<Trigger, { kind: "composio" }>, event) {
		return trigger.appId.toLowerCase() === event.fields.app && trigger.event.toUpperCase() === event.fields.event?.toUpperCase();
	},
};
