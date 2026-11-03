import { registerSessionResourceCleanup } from "../session-resources.ts";
import type { AssistantMessage, TranscriptContext } from "../types.ts";
import {
	canContinueGeminiWebConversation,
	type GeminiWebConversation,
	type GeminiWebSession,
} from "./gemini-web-protocol.ts";
import { buildGeminiWebPrompt } from "./gemini-web-tools.ts";

const MAX_CONVERSATIONS = 32;
const MAX_IDLE_MS = 2 * 60 * 60_000;

export interface GeminiWebBootstrap {
	cookie: string;
	session: GeminiWebSession;
	expiresAt: number;
}

interface CachedConversation {
	identity: string;
	prefix: string;
	messageCount: number;
	metadata: GeminiWebConversation;
	bootstrap?: GeminiWebBootstrap;
}

interface ConversationSlot {
	touched: number;
	cached?: CachedConversation;
}

const conversations = new Map<string, ConversationSlot>();

registerSessionResourceCleanup((sessionId) => {
	if (sessionId === undefined) conversations.clear();
	else conversations.delete(sessionId);
});

/**
 * Reuse only an exact transcript prefix in the same local session, account, and model. A fork, compaction,
 * changed instruction/tool schema, or process restart starts a new temporary chat. No keepalive requests or
 * timers: expired entries are discarded on the next real request. In-flight calls reserve their slot so a
 * concurrent request or session disposal cannot publish stale continuation metadata.
 */
export function prepareGeminiWebConversation(input: {
	context: TranscriptContext;
	cookie: string;
	model: string;
	sessionId?: string;
	compactHistory?: boolean;
}): {
	prompt: string;
	metadata?: GeminiWebConversation;
	bootstrap?: GeminiWebBootstrap;
	save: (output: AssistantMessage, metadata: GeminiWebConversation | undefined, bootstrap?: GeminiWebBootstrap) => void;
} {
	const { context, sessionId } = input;
	// Match the complete history even when the wire replay shortens older outputs. Otherwise an edit inside an
	// omitted region could incorrectly reuse a conversation that contains a different version of that output.
	const fullPrompt = buildGeminiWebPrompt(context);
	const replay = () => buildGeminiWebPrompt(context, 0, input.compactHistory !== false);
	if (!sessionId) return { prompt: replay(), save: () => {} };

	const now = Date.now();
	for (const [key, slot] of conversations) {
		if (now - slot.touched >= MAX_IDLE_MS) conversations.delete(key);
	}
	const previous = conversations.get(sessionId)?.cached;
	const identity = JSON.stringify([input.cookie.split(";")[0], input.model, input.compactHistory !== false]);
	const matches =
		previous?.identity === identity &&
		context.messages.length > previous.messageCount &&
		buildGeminiWebPrompt({ ...context, messages: context.messages.slice(0, previous.messageCount) }) ===
			previous.prefix;

	const slot: ConversationSlot = { touched: now };
	conversations.delete(sessionId);
	conversations.set(sessionId, slot);
	while (conversations.size > MAX_CONVERSATIONS) conversations.delete(conversations.keys().next().value!);

	return {
		prompt: matches ? buildGeminiWebPrompt(context, previous.messageCount) : replay(),
		metadata: matches ? [...previous.metadata] : undefined,
		bootstrap:
			matches && previous.bootstrap?.cookie === input.cookie && previous.bootstrap.expiresAt > now
				? { ...previous.bootstrap, session: { ...previous.bootstrap.session } }
				: undefined,
		save: (output, metadata, bootstrap) => {
			if (conversations.get(sessionId) !== slot || !metadata || !canContinueGeminiWebConversation(metadata)) return;
			// Callers may edit message objects while a request is in flight. Never cache a history Google did not see.
			if (buildGeminiWebPrompt(context) !== fullPrompt) return;
			slot.touched = Date.now();
			slot.cached = {
				identity,
				prefix: buildGeminiWebPrompt({ ...context, messages: [...context.messages, output] }),
				messageCount: context.messages.length + 1,
				metadata: [...metadata],
				bootstrap: bootstrap ? { ...bootstrap, session: { ...bootstrap.session } } : undefined,
			};
		},
	};
}
