// Webhooks (spec section 12): each routine can mint a URL with a secret, so Linear, Sentry, PagerDuty, Stripe and any
// service with outgoing webhooks can fire it. Only the secret's hash is stored; the URL is shown once, when minted.
import type { Trigger } from "@knightcode/bots-protocol";
import { randomToken, sha256 } from "../auth/util.ts";
import { asOutsideText, sameSignature, type TriggerAdapter, type TriggerEvent } from "./triggers.ts";

const PATH = /^\/hooks\/w\/([a-z0-9_]+)\/([A-Za-z0-9_-]+)$/;

/** A new webhook for a routine: its id, and the secret URL to show the user once. */
export async function mintWebhook(
	db: D1Database,
	input: { routineId: string; botId: string; accountId: string; origin: string },
): Promise<{ id: string; url: string }> {
	const id = `wh_${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
	const secret = randomToken(24);
	await db
		.prepare("INSERT INTO routine_triggers (routine_id, bot_id, account_id, kind, route_key, secret_hash) VALUES (?, ?, ?, 'webhook', ?, ?)")
		.bind(input.routineId, input.botId, input.accountId, id, await sha256(secret))
		.run();
	return { id, url: `${input.origin}/hooks/w/${id}/${secret}` };
}

export const webhookAdapter: TriggerAdapter<"webhook"> = {
	kind: "webhook",
	async verify(request, env) {
		const match = PATH.exec(new URL(request.url).pathname);
		if (!match || request.method !== "POST") return undefined;
		const [, id, secret] = match;
		const row = await env.DB.prepare("SELECT secret_hash FROM routine_triggers WHERE kind = 'webhook' AND route_key = ?")
			.bind(id)
			.first<{ secret_hash: string }>();
		if (!row || !sameSignature(row.secret_hash, await sha256(secret!))) return undefined;
		const body = (await request.text()).slice(0, 100_000);
		const event: TriggerEvent = {
			kind: "webhook",
			routeKey: id!,
			title: `Webhook ${id}`,
			text: asOutsideText(`a webhook (${request.headers.get("user-agent") ?? "unknown sender"})`, body),
			fields: { id },
		};
		return event;
	},
	matches(trigger: Extract<Trigger, { kind: "webhook" }>, event) {
		return !trigger.id || trigger.id === event.routeKey;
	},
};
