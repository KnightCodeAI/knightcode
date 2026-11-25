/** In-memory transport fixture: real store notifications, no process, credentials or provider API. */
import type { ResultOf, Turn } from "@knightcode/app-server-protocol";
import type { AnyNotification } from "../../src/renderer/client.ts";

export const threadId = "streaming-profile";
export const chunks = 80;
export const history = 30;
const listeners = new Set<(notification: AnyNotification) => void>();
const startedAt = Date.UTC(2026, 10, 12, 12);
const turns: Turn[] = Array.from({ length: history + 1 }, (_, index) => ({
	id: `turn-${index}`,
	threadId,
	status: index === history ? "inProgress" : "completed",
	startedAt,
	...(index === history ? {} : { completedAt: startedAt + 1 }),
	items: [
		{ type: "userMessage", id: `user-${index}`, text: `Question ${index}`, images: [] },
		{
			type: "agentMessage",
			id: `reply-${index}`,
			text: `Reply ${index}.`,
			...(index === history ? {} : { completedAt: startedAt + 1 }),
		},
	],
}));
const snapshot: ResultOf<"thread/resume"> = {
	thread: {
		id: threadId,
		cwd: "/fixture",
		projectCwd: "/fixture",
		name: "Streaming profile",
		status: { type: "active", waitingOn: [] },
		archived: false,
		createdAt: new Date(startedAt).toISOString(),
		updatedAt: new Date(startedAt).toISOString(),
		workspace: { mode: "local" },
		approvalMode: "ask",
		thinkingLevel: "off",
	},
	turns,
	queue: { steering: [], followUp: [] },
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextWindow: 100000 },
	warnings: [],
	ui: { statuses: [], workingVisible: true, widgets: [] },
};

export const client = {
	onNotification: (callback: (notification: AnyNotification) => void) => {
		listeners.add(callback);
		return () => {
			listeners.delete(callback);
		};
	},
	onServerRequest: () => () => {},
	onHostEvent: () => () => {},
	respond: () => {},
	request: async (method: string) => {
		if (method === "thread/resume") return snapshot;
		if (method === "thread/backgroundShells/list") return { shells: [] };
		throw new Error(`Unexpected profiler request: ${method}`);
	},
	host: async () => ({}),
};
export class RequestError extends Error {}

export function emitChunk() {
	for (const listener of listeners)
		listener({
			method: "item/agentMessage/delta",
			params: { threadId, turnId: `turn-${history}`, itemId: `reply-${history}`, delta: " streaming" },
		});
}
