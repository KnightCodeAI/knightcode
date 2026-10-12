/**
 * The app server protocol (apps/desktop/docs/desktop-app/architecture.md §4).
 *
 * JSON-RPC 2.0 shapes without the "jsonrpc" member. Every object schema
 * rejects unknown members, so a typo in a client fails loudly at the server.
 * This module imports nothing from @knightcode/ai or @knightcode/agent: the
 * desktop renderer imports it to get a type.
 */

import { type Static, type TSchema, Type } from "typebox";

export const PROTOCOL_VERSION = 1;

function Obj<P extends Record<string, TSchema>>(properties: P) {
	return Type.Object(properties, { additionalProperties: false });
}

const Str = Type.String();
const Num = Type.Number();
const Bool = Type.Boolean();
const Empty = Obj({});
const ThreadId = Obj({ threadId: Str });

export const RequestId = Type.Union([Type.String({ maxLength: 128 }), Type.Number()]);
export type RequestId = Static<typeof RequestId>;

export const ErrorCode = Type.Union([
	Type.Literal("invalidParams"),
	Type.Literal("methodNotFound"),
	Type.Literal("notInitialized"),
	Type.Literal("versionMismatch"),
	Type.Literal("threadNotFound"),
	Type.Literal("threadLockedElsewhere"),
	Type.Literal("turnInProgress"),
	Type.Literal("invalidCursor"),
	Type.Literal("payloadNotFound"),
	Type.Literal("archiveConflict"),
	Type.Literal("authRequired"),
	Type.Literal("gitConflict"),
	Type.Literal("notGitRepo"),
	Type.Literal("toolMissing"),
	Type.Literal("shuttingDown"),
	Type.Literal("internal"),
]);
export type ErrorCode = Static<typeof ErrorCode>;

export const ResponseError = Obj({ code: ErrorCode, message: Str, data: Type.Optional(Type.Unknown()) });
export type ResponseError = Static<typeof ResponseError>;

/** Any well-formed message; per-method params are checked after dispatch. */
export const Envelope = Type.Union([
	Obj({ id: RequestId, method: Str, params: Type.Unknown() }),
	Obj({ method: Str, params: Type.Unknown() }),
	Obj({ id: RequestId, result: Type.Unknown() }),
	Obj({ id: RequestId, error: ResponseError }),
]);
export interface Request {
	id: RequestId;
	method: string;
	params: unknown;
}
export interface Notification {
	method: string;
	params: unknown;
}
export type Response = { id: RequestId; result: unknown } | { id: RequestId; error: ResponseError };
export type Message = Request | Notification | Response;

export const ApprovalMode = Type.Union([Type.Literal("ask"), Type.Literal("autoEdit"), Type.Literal("fullAccess")]);
export type ApprovalMode = Static<typeof ApprovalMode>;

export const ThinkingLevel = Type.Union([
	Type.Literal("off"),
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("max"),
]);
export type ThinkingLevel = Static<typeof ThinkingLevel>;

export const ModelRef = Obj({ provider: Str, id: Str, name: Str, contextWindow: Num });
export type ModelRef = Static<typeof ModelRef>;
export const ModelSelector = Obj({ provider: Str, id: Str });
export type ModelSelector = Static<typeof ModelSelector>;
export const ImageRef = Obj({ mimeType: Str, data: Str });
export type ImageRef = Static<typeof ImageRef>;
export const ToolOutput = Type.Union([
	Obj({ type: Type.Literal("text"), text: Str }),
	Obj({ type: Type.Literal("image"), mimeType: Str, data: Str }),
]);
export type ToolOutput = Static<typeof ToolOutput>;

export const ThreadStatus = Type.Union([Type.Literal("notLoaded"), Type.Literal("idle"), Type.Literal("active")]);
/** Phase A has local workspaces only; Phase B adds worktrees. */
export const Workspace = Obj({ mode: Type.Literal("local") });

export const ThreadSummary = Obj({
	id: Str,
	cwd: Str,
	projectCwd: Str,
	name: Str,
	status: ThreadStatus,
	archived: Bool,
	updatedAt: Str,
});
export type ThreadSummary = Static<typeof ThreadSummary>;

export const Thread = Obj({
	id: Str,
	cwd: Str,
	projectCwd: Str,
	name: Str,
	status: ThreadStatus,
	archived: Bool,
	updatedAt: Str,
	workspace: Workspace,
	approvalMode: ApprovalMode,
	model: Type.Optional(ModelRef),
	thinkingLevel: ThinkingLevel,
});
export type Thread = Static<typeof Thread>;

export const FileChange = Obj({
	path: Str,
	kind: Type.Union([Type.Literal("add"), Type.Literal("modify"), Type.Literal("delete")]),
});
export type FileChange = Static<typeof FileChange>;

export const ToolCallStatus = Type.Union([
	Type.Literal("pending"),
	Type.Literal("running"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("declined"),
]);
export type ToolCallStatus = Static<typeof ToolCallStatus>;

export const Item = Type.Union([
	Obj({ type: Type.Literal("userMessage"), id: Str, text: Str, images: Type.Array(ImageRef) }),
	Obj({ type: Type.Literal("agentMessage"), id: Str, text: Str }),
	Obj({ type: Type.Literal("reasoning"), id: Str, text: Str }),
	Obj({
		type: Type.Literal("toolCall"),
		id: Str,
		tool: Str,
		input: Type.Unknown(),
		status: ToolCallStatus,
		output: Type.Array(ToolOutput),
		parentItemId: Type.Optional(Str),
		/** Set on completion for `edit` and `write`; part of the call, so it has no position of its own (§4.2). */
		fileChanges: Type.Optional(Type.Array(FileChange)),
	}),
	Obj({ type: Type.Literal("compaction"), id: Str, summary: Str }),
	Obj({ type: Type.Literal("extensionMessage"), id: Str, extension: Str, text: Str }),
]);
export type Item = Static<typeof Item>;

export const TurnStatus = Type.Union([
	Type.Literal("inProgress"),
	Type.Literal("completed"),
	Type.Literal("interrupted"),
	Type.Literal("failed"),
]);
export const Turn = Obj({
	id: Str,
	threadId: Str,
	status: TurnStatus,
	error: Type.Optional(Str),
	items: Type.Array(Item),
});
export type Turn = Static<typeof Turn>;

export const PayloadRef = Obj({ id: Str, byteLength: Type.Integer({ minimum: 0 }) });
export type PayloadRef = Static<typeof PayloadRef>;
export const ItemReference = Obj({
	type: Type.Literal("itemReference"),
	id: Str,
	itemType: Type.Union([
		Type.Literal("userMessage"),
		Type.Literal("agentMessage"),
		Type.Literal("reasoning"),
		Type.Literal("toolCall"),
		Type.Literal("compaction"),
		Type.Literal("extensionMessage"),
	]),
	payload: PayloadRef,
});
export const WireItem = Type.Union([Item, ItemReference]);
export type WireItem = Static<typeof WireItem>;
export const TurnSummary = Obj({
	id: Str,
	threadId: Str,
	status: TurnStatus,
	error: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type TurnSummary = Static<typeof TurnSummary>;
export const TurnReference = Obj({
	id: Str,
	threadId: Str,
	status: TurnStatus,
	error: Type.Optional(Type.String({ maxLength: 2000 })),
	payload: PayloadRef,
});
export const WireTurn = Type.Union([Turn, TurnReference]);
export type WireTurn = Static<typeof WireTurn>;
export const TurnStartResult = Obj({
	status: Type.Union([Type.Literal("started"), Type.Literal("handled"), Type.Literal("cancelled")]),
	threadId: Str,
	requestId: Str,
});
export type TurnStartResult = Static<typeof TurnStartResult>;

const ModelInfo = Obj({
	provider: Str,
	providerName: Str,
	id: Str,
	name: Str,
	contextWindow: Num,
	maxTokens: Num,
	reasoning: Bool,
	input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")])),
});
const AuthKind = Type.Union([Type.Literal("oauth"), Type.Literal("api_key")]);
const Prompt = Obj({
	type: Str,
	message: Str,
	placeholder: Type.Optional(Str),
	options: Type.Optional(Type.Array(Obj({ id: Str, label: Str, description: Type.Optional(Str) }))),
});
/** Auth events carry URLs, device codes and progress text, never an entered secret. */
const AuthEvent = Type.Record(Str, Type.Unknown());
export const LoginState = Type.Union([
	Obj({
		status: Type.Literal("pending"),
		loginId: Str,
		events: Type.Array(AuthEvent),
		pendingPrompt: Type.Optional(Obj({ id: Str, prompt: Prompt })),
	}),
	Obj({ status: Type.Literal("complete"), loginId: Str, events: Type.Array(AuthEvent) }),
	Obj({ status: Type.Literal("failed"), loginId: Str, events: Type.Array(AuthEvent), error: Str }),
]);
export type LoginState = Static<typeof LoginState>;

const TurnInput = Obj({ threadId: Str, text: Str, images: Type.Optional(Type.Array(ImageRef)) });

export const ClientRequests = {
	initialize: {
		params: Obj({
			clientInfo: Obj({ name: Str, version: Str }),
			protocolVersion: Num,
			capabilities: Obj({ localHandles: Type.Optional(Bool) }),
		}),
		result: Obj({ serverInfo: Obj({ name: Type.Literal("knightcode"), version: Str }), protocolVersion: Num }),
	},
	"thread/start": {
		params: Obj({
			cwd: Str,
			workspace: Type.Optional(Workspace),
			approvalMode: Type.Optional(ApprovalMode),
			model: Type.Optional(ModelSelector),
			thinkingLevel: Type.Optional(ThinkingLevel),
		}),
		result: Obj({ thread: Thread }),
	},
	"thread/resume": {
		params: Obj({ threadId: Str, cursor: Type.Optional(Str) }),
		result: Obj({
			thread: Thread,
			turns: Type.Array(WireTurn),
			runningTurn: Type.Optional(WireTurn),
			nextCursor: Type.Optional(Str),
		}),
	},
	"thread/fork": { params: Obj({ threadId: Str, atItemId: Type.Optional(Str) }), result: Obj({ thread: Thread }) },
	"thread/list": {
		params: Obj({ cwd: Type.Optional(Str), cursor: Type.Optional(Str), archived: Type.Optional(Bool) }),
		result: Obj({ threads: Type.Array(ThreadSummary), nextCursor: Type.Optional(Str) }),
	},
	"thread/read": {
		params: Obj({ threadId: Str, cursor: Type.Optional(Str) }),
		// `Thread` when the thread is loaded; `ThreadSummary` when it is not: workspace, approval mode, model and
		// thinking level live in session state that only a load restores (§4.4).
		result: Obj({
			thread: Type.Union([Thread, ThreadSummary]),
			turns: Type.Array(WireTurn),
			runningTurn: Type.Optional(WireTurn),
			nextCursor: Type.Optional(Str),
		}),
	},
	"thread/unsubscribe": { params: ThreadId, result: Empty },
	"thread/archive": { params: ThreadId, result: Empty },
	"thread/unarchive": { params: ThreadId, result: Empty },
	"thread/name/set": { params: Obj({ threadId: Str, name: Str }), result: Empty },
	"thread/settings/update": {
		params: Obj({
			threadId: Str,
			model: Type.Optional(ModelSelector),
			thinkingLevel: Type.Optional(ThinkingLevel),
			approvalMode: Type.Optional(ApprovalMode),
		}),
		result: Obj({ thread: Thread }),
	},
	"thread/compact": { params: Obj({ threadId: Str, instructions: Type.Optional(Str) }), result: Empty },
	"turn/start": {
		params: Obj({
			threadId: Str,
			text: Str,
			images: Type.Optional(Type.Array(ImageRef)),
			requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		}),
		result: TurnStartResult,
	},
	"payload/read": {
		params: Obj({
			id: Str,
			offset: Type.Integer({ minimum: 0 }),
			maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 49152 })),
		}),
		result: Obj({ data: Str, nextOffset: Type.Optional(Type.Integer({ minimum: 0 })), eof: Bool }),
	},
	"turn/steer": { params: TurnInput, result: Empty },
	"turn/followUp": { params: TurnInput, result: Empty },
	"turn/interrupt": { params: ThreadId, result: Empty },
	"model/list": {
		params: Empty,
		result: Obj({ models: Type.Array(ModelInfo), default: Type.Union([Str, Type.Null()]) }),
	},
	"command/list": { params: ThreadId, result: Obj({ commands: Type.Array(Obj({ name: Str, description: Str })) }) },
	"config/read": { params: Obj({ cwd: Type.Optional(Str) }), result: Obj({ settings: Type.Unknown() }) },
	"account/list": {
		params: Empty,
		result: Obj({
			accounts: Type.Array(Obj({ provider: Str, providerName: Str, type: AuthKind, isSubscription: Bool })),
			loginOptions: Type.Array(
				Obj({ provider: Str, providerName: Str, type: AuthKind, label: Str, isSubscription: Bool }),
			),
		}),
	},
	"account/login/start": { params: Obj({ provider: Str, type: AuthKind }), result: Obj({ loginId: Str }) },
	"account/login/answer": { params: Obj({ loginId: Str, value: Str }), result: Empty },
	"account/login/cancel": { params: Obj({ loginId: Str }), result: Empty },
	"account/logout": { params: Obj({ provider: Str }), result: Empty },
} as const;

export const ClientNotifications = { initialized: Empty } as const;

/**
 * `index`: the item's position among its turn's top-level items, as in thread/read (§4.2). Provisional on
 * item/started for a streaming item, final on item/completed. Absent for nested calls (`parentItemId`).
 */
const ItemEvent = Obj({ threadId: Str, turnId: Str, item: WireItem, index: Type.Optional(Num) });
const Delta = Obj({ threadId: Str, turnId: Str, itemId: Str, delta: Str });

export const ServerNotifications = {
	"thread/started": Obj({ thread: Thread }),
	"thread/replaced": Obj({ oldThreadId: Str, thread: Thread }),
	"thread/status/changed": Obj({ threadId: Str, status: ThreadStatus }),
	"thread/name/updated": Obj({ threadId: Str, name: Str }),
	"thread/settings/updated": Obj({ thread: Thread }),
	"thread/archived": Obj({ threadId: Str, archived: Bool }),
	"turn/started": Obj({ turn: Turn, requestId: Type.Optional(Str) }),
	"turn/completed": Obj({ turn: TurnSummary }),
	"turn/retry": Obj({ threadId: Str, turnId: Str, attempt: Num, maxAttempts: Num, delayMs: Num, error: Str }),
	"turn/queue/updated": Obj({ threadId: Str, steering: Type.Array(Str), followUp: Type.Array(Str) }),
	"item/started": ItemEvent,
	"item/completed": ItemEvent,
	/** A streamed item whose block the finalized message no longer has (a message_end handler replaced it). */
	"item/removed": Obj({ threadId: Str, turnId: Str, itemId: Str }),
	"item/agentMessage/delta": Delta,
	"item/reasoning/delta": Delta,
	"item/toolCall/outputDelta": Obj({
		threadId: Str,
		turnId: Str,
		itemId: Str,
		output: Type.Union([Type.Array(ToolOutput), PayloadRef]),
	}),
	"serverRequest/cancelled": Obj({ id: RequestId }),
	"account/login/updated": LoginState,
	"account/updated": Obj({ provider: Str, authenticated: Bool }),
	error: Obj({ message: Str, threadId: Type.Optional(Str) }),
} as const;

export const ApprovalDecision = Type.Union([
	Type.Literal("accept"),
	Type.Literal("acceptForSession"),
	Type.Literal("decline"),
	Type.Literal("cancel"),
]);
export type ApprovalDecision = Static<typeof ApprovalDecision>;

export const ServerRequests = {
	"item/toolCall/requestApproval": {
		params: Type.Union([
			Obj({
				threadId: Str,
				turnId: Str,
				itemId: Str,
				tool: Str,
				input: Type.Unknown(),
				parentItemId: Type.Optional(Str),
			}),
			Obj({
				threadId: Str,
				turnId: Str,
				itemId: Str,
				tool: Str,
				inputRef: PayloadRef,
				parentItemId: Type.Optional(Str),
			}),
		]),
		result: Obj({ decision: ApprovalDecision }),
	},
} as const;

export type ClientMethod = keyof typeof ClientRequests;
export type ParamsOf<M extends ClientMethod> = Static<(typeof ClientRequests)[M]["params"]>;
export type ResultOf<M extends ClientMethod> = Static<(typeof ClientRequests)[M]["result"]>;
export type NotificationMethod = keyof typeof ServerNotifications;
export type NotificationParams<M extends NotificationMethod> = Static<(typeof ServerNotifications)[M]>;
export type ServerRequestMethod = keyof typeof ServerRequests;
export type ServerRequestParams<M extends ServerRequestMethod> = Static<(typeof ServerRequests)[M]["params"]>;
export type ServerRequestResult<M extends ServerRequestMethod> = Static<(typeof ServerRequests)[M]["result"]>;

/** The JSON Schema document written to packages/cli/docs/app-server.schema.json. */
export function schemaDocument() {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: "KnightCode app server protocol",
		protocolVersion: PROTOCOL_VERSION,
		envelope: Envelope,
		clientRequests: ClientRequests,
		clientNotifications: ClientNotifications,
		serverNotifications: ServerNotifications,
		serverRequests: ServerRequests,
	};
}
