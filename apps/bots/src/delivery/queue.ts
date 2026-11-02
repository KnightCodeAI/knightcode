// Delivery of outward writes (spec section 24). The queue carries only a bot id and an action id; the record in the bot
// object is the truth, so a lost or repeated queue message never repeats an action whose outcome is unknown.
import { type ActionRecord, type ActionState, dispatch, type WriteAdapter } from "../bot/actions.ts";
import type { Env, OutboundMessage } from "../env.ts";

const adapters = new Map<string, WriteAdapter>();

/** Makes `adapter` deliver actions whose tool is `adapter.id` (channels and connectors register theirs). */
export function registerAdapter(adapter: WriteAdapter): () => void {
	adapters.set(adapter.id, adapter);
	return () => {
		if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id);
	};
}

export const adapterFor = (tool: string): WriteAdapter | undefined => adapters.get(tool);

/** Sends until the action is sent, confirmed or unknown; a send that definitely failed is tried up to `attempts` times. */
export async function deliverWithRetries(
	sql: SqlStorage,
	adapter: WriteAdapter,
	record: ActionRecord,
	attempts = 3,
): Promise<ActionState> {
	let state: ActionState = record.state;
	for (let attempt = 0; attempt < attempts; attempt++) {
		state = await dispatch(sql, record, adapter);
		if (state !== "pending") return state;
	}
	return state;
}

/** The queue consumer: each message asks its bot to deliver one action; a definite failure is retried by the queue. */
export async function consumeOutbound(batch: MessageBatch<OutboundMessage>, env: Env): Promise<void> {
	for (const message of batch.messages) {
		const { botId, actionId } = message.body;
		try {
			const state = await env.BOT.get(env.BOT.idFromName(botId)).deliverAction(actionId);
			if (state === "pending") message.retry();
			else message.ack();
		} catch {
			message.retry();
		}
	}
}
