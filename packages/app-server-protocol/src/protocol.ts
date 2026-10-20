/**
 * The app server protocol (apps/desktop/docs/desktop-app/architecture.md §4).
 *
 * JSON-RPC 2.0 shapes without the "jsonrpc" member. Every object schema
 * rejects unknown members, so a typo in a client fails loudly at the server.
 * This module imports nothing from @knightcode/ai or @knightcode/agent: the
 * desktop renderer imports it to get a type.
 */

import { type Static, type TSchema, Type } from "typebox";

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
	Type.Literal("turnMismatch"),
	Type.Literal("configConflict"),
	Type.Literal("threadNotArchived"),
	Type.Literal("shuttingDown"),
	Type.Literal("internal"),
]);
export type ErrorCode = Static<typeof ErrorCode>;

export const Platform = Obj({
	os: Type.Union([Type.Literal("win32"), Type.Literal("darwin"), Type.Literal("linux")]),
	arch: Str,
	homeDir: Str,
});

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
export const ImageInput = Type.Union([ImageRef, Obj({ path: Str })]);
export type ImageInput = Static<typeof ImageInput>;
const ClientMessageId = Type.String({ minLength: 1, maxLength: 128 });
export const ToolOutput = Type.Union([
	Obj({ type: Type.Literal("text"), text: Str }),
	Obj({ type: Type.Literal("image"), mimeType: Str, data: Str }),
]);
export type ToolOutput = Static<typeof ToolOutput>;

export const ThreadStatus = Type.Union([
	Obj({ type: Type.Literal("notLoaded") }),
	Obj({ type: Type.Literal("idle") }),
	Obj({
		type: Type.Literal("active"),
		waitingOn: Type.Array(Type.Union([Type.Literal("approval"), Type.Literal("dialog")])),
	}),
	Obj({ type: Type.Literal("systemError"), message: Str }),
]);
export type ThreadStatus = Static<typeof ThreadStatus>;
/** What a thread/start asks for (§6.1). */
export const WorkspaceRequest = Type.Union([
	Obj({ mode: Type.Literal("local") }),
	Obj({
		mode: Type.Literal("worktree"),
		/** Branch or commit to start from; default the project checkout's HEAD (Codex's "What branch should this chat start from?"). */
		baseRef: Type.Optional(Str),
		/** Bring the project checkout's uncommitted changes along, as uncommitted edits. Not with baseRef. */
		carryLocalChanges: Type.Optional(Bool),
		/** A name from the project's .knightcode/environments.json; absent = "Work without environment". */
		environment: Type.Optional(Str),
	}),
]);
export type WorkspaceRequest = Static<typeof WorkspaceRequest>;
export const Workspace = Type.Union([
	Obj({
		mode: Type.Literal("local"),
		/** The worktree a handed-off thread came from; a handoff back returns it there. */
		worktree: Type.Optional(Str),
	}),
	Obj({
		mode: Type.Literal("worktree"),
		/** The worktree's root; the thread's cwd is this or the same subdirectory the project cwd had. */
		path: Str,
		/** The commit the worktree started from (a SHA). */
		baseRef: Str,
		/** The thread that created the worktree. */
		ownerThreadId: Str,
		environment: Type.Optional(Str),
		setupFailed: Type.Optional(Bool),
		/** The worktree was deleted; thread/worktree/restore brings it back. */
		deleted: Type.Optional(Bool),
	}),
]);
export type Workspace = Static<typeof Workspace>;
const WorkspaceMode = Type.Union([Type.Literal("local"), Type.Literal("worktree")]);

const PlatformScript = Obj({
	default: Type.Optional(Str),
	macos: Type.Optional(Str),
	linux: Type.Optional(Str),
	windows: Type.Optional(Str),
});
export type PlatformScript = Static<typeof PlatformScript>;
export const Environment = Obj({
	name: Type.String({ minLength: 1, maxLength: 100 }),
	setup: Type.Optional(PlatformScript),
	cleanup: Type.Optional(PlatformScript),
	/** Shown in the desktop's toolbar and run in its terminal (desktop shell S2); the server only stores them. */
	actions: Type.Optional(
		Type.Array(
			Obj({ name: Type.String({ minLength: 1, maxLength: 100 }), icon: Type.Optional(Str), command: PlatformScript }),
			{ maxItems: 50 },
		),
	),
});
export type Environment = Static<typeof Environment>;

export const DiffScope = Type.Union([
	Type.Literal("lastTurn"),
	Type.Literal("uncommitted"),
	Type.Literal("unstaged"),
	Type.Literal("staged"),
	Type.Literal("committed"),
	Type.Literal("branch"),
]);
export type DiffScope = Static<typeof DiffScope>;
/** Which diff a hunk, a revert or a comment refers to. */
const ScopeSelector = {
	scope: Type.Optional(DiffScope),
	/** `branch`: the branch to compare with (Codex's "HEAD → Select branch"). */
	against: Type.Optional(Str),
	/** `committed`: the commit to show, from git/log. */
	commit: Type.Optional(Str),
};
export const DiffHunk = Obj({
	/** sha256 of path, header and lines: a hunk that changed gets a new id. */
	id: Str,
	header: Str,
	oldStart: Num,
	oldLines: Num,
	newStart: Num,
	newLines: Num,
	/** Each line keeps its prefix: " ", "+", "-", or "\\" for "No newline at end of file". */
	lines: Type.Array(Str),
});
export type DiffHunk = Static<typeof DiffHunk>;
export const DiffFile = Obj({
	path: Str,
	oldPath: Type.Optional(Str),
	status: Type.Union([
		Type.Literal("added"),
		Type.Literal("modified"),
		Type.Literal("deleted"),
		Type.Literal("renamed"),
		Type.Literal("typeChanged"),
	]),
	binary: Bool,
	additions: Num,
	deletions: Num,
	/** Hunks left out: the file's patch is over 512 KiB, or the read's raw or serialized budget ran out. */
	tooLarge: Type.Optional(Bool),
	hunks: Type.Array(DiffHunk),
});
export type DiffFile = Static<typeof DiffFile>;
export const DiffComment = Obj({
	...ScopeSelector,
	path: Str,
	/** Codex's L/R: the old or the new side of the diff. */
	side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
	startLine: Type.Integer({ minimum: 1 }),
	endLine: Type.Integer({ minimum: 1 }),
	body: Type.String({ minLength: 1, maxLength: 8000 }),
});
export type DiffComment = Static<typeof DiffComment>;
const Comments = Type.Optional(Type.Array(DiffComment, { minItems: 1, maxItems: 50 }));
const ReadContext = Type.Integer({ minimum: 0, maximum: 1_000_000 });
const ActionContext = Type.Integer({ minimum: 1, maximum: 1_000_000 });
const DiffTarget = {
	threadId: Str,
	path: Type.Optional(Str),
	hunkId: Type.Optional(Str),
	context: Type.Optional(ActionContext),
};
const BranchName = Type.String({ maxLength: 200 });

/** `data.reason` of a gitConflict error. */
export const GitConflictReason = Type.Union([
	Type.Literal("diffChanged"),
	Type.Literal("patchFailed"),
	Type.Literal("concurrentChange"),
	Type.Literal("pushRejected"),
	Type.Literal("localChanges"),
	Type.Literal("operationInProgress"),
	Type.Literal("branchExists"),
	Type.Literal("recoveryRequired"),
	Type.Literal("worktreeDeleted"),
	Type.Literal("worktreeMissing"),
	Type.Literal("worktreeInUse"),
	Type.Literal("submodules"),
]);
export type GitConflictReason = Static<typeof GitConflictReason>;

export const ThreadSummary = Obj({
	id: Str,
	cwd: Str,
	projectCwd: Str,
	name: Str,
	status: ThreadStatus,
	archived: Bool,
	createdAt: Str,
	forkedFromId: Type.Optional(Str),
	updatedAt: Str,
	workspaceMode: WorkspaceMode,
});
export type ThreadSummary = Static<typeof ThreadSummary>;

export const Thread = Obj({
	id: Str,
	cwd: Str,
	projectCwd: Str,
	name: Str,
	status: ThreadStatus,
	archived: Bool,
	createdAt: Str,
	forkedFromId: Type.Optional(Str),
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
	diff: Type.Optional(Str),
});
export type FileChange = Static<typeof FileChange>;

/** A file a turn changed, with its line totals between the working tree before and after the turn (§6.2). */
export const TurnFile = Obj({ path: Str, additions: Num, deletions: Num });
export type TurnFile = Static<typeof TurnFile>;

export const ToolCallStatus = Type.Union([
	Type.Literal("pending"),
	Type.Literal("running"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("declined"),
]);
export type ToolCallStatus = Static<typeof ToolCallStatus>;

const Times = { startedAt: Type.Optional(Num), completedAt: Type.Optional(Num) };

export const Item = Type.Union([
	Obj({
		type: Type.Literal("userMessage"),
		id: Str,
		text: Str,
		images: Type.Array(ImageRef),
		clientMessageId: Type.Optional(ClientMessageId),
		/** Review comments sent with the input; the model read them quoted into its text. */
		comments: Type.Optional(Type.Array(DiffComment)),
		...Times,
	}),
	Obj({ type: Type.Literal("agentMessage"), id: Str, text: Str, ...Times }),
	Obj({ type: Type.Literal("reasoning"), id: Str, text: Str, ...Times }),
	Obj({
		type: Type.Literal("toolCall"),
		...Times,
		id: Str,
		tool: Str,
		input: Type.Unknown(),
		status: ToolCallStatus,
		output: Type.Array(ToolOutput),
		parentItemId: Type.Optional(Str),
		/** Set on completion for `edit` and `write`; part of the call, so it has no position of its own (§4.2). */
		fileChanges: Type.Optional(Type.Array(FileChange)),
	}),
	Obj({ type: Type.Literal("compaction"), id: Str, summary: Str, ...Times }),
	Obj({ type: Type.Literal("extensionMessage"), id: Str, extension: Str, text: Str, ...Times }),
]);
export type Item = Static<typeof Item>;

export const TurnStatus = Type.Union([
	Type.Literal("inProgress"),
	Type.Literal("completed"),
	Type.Literal("interrupted"),
	Type.Literal("failed"),
]);
export const TurnErrorKind = Type.Union([
	Type.Literal("auth"),
	Type.Literal("rateLimit"),
	Type.Literal("contextOverflow"),
	Type.Literal("network"),
	Type.Literal("provider"),
	Type.Literal("other"),
]);
export const TurnError = Obj({ message: Str, kind: TurnErrorKind });
export type TurnError = Static<typeof TurnError>;
const SummaryError = Obj({ message: Type.String({ maxLength: 2000 }), kind: TurnErrorKind });

export const Turn = Obj({
	id: Str,
	threadId: Str,
	status: TurnStatus,
	startedAt: Num,
	completedAt: Type.Optional(Num),
	error: Type.Optional(TurnError),
	items: Type.Array(Item),
	/** What the turn changed in a git checkout, once recorded; live, `turn/diff/updated` brings it after `turn/completed`. */
	files: Type.Optional(Type.Array(TurnFile)),
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
	startedAt: Num,
	completedAt: Type.Optional(Num),
	error: Type.Optional(SummaryError),
});
export type TurnSummary = Static<typeof TurnSummary>;
export const TurnReference = Obj({
	id: Str,
	threadId: Str,
	status: TurnStatus,
	startedAt: Num,
	completedAt: Type.Optional(Num),
	error: Type.Optional(SummaryError),
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

export const TokenUsage = Obj({
	input: Num,
	output: Num,
	cacheRead: Num,
	cacheWrite: Num,
	cost: Num,
	contextTokens: Type.Optional(Num),
	contextWindow: Num,
});
export type TokenUsage = Static<typeof TokenUsage>;

const ModelInfo = Obj({
	provider: Str,
	providerName: Str,
	id: Str,
	name: Str,
	contextWindow: Num,
	maxTokens: Num,
	reasoning: Bool,
	thinkingLevels: Type.Array(ThinkingLevel),
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

const WarningFields = {
	message: Str,
	source: Type.Union([
		Type.Literal("settings"),
		Type.Literal("extension"),
		Type.Literal("trust"),
		Type.Literal("server"),
	]),
	path: Type.Optional(Str),
	line: Type.Optional(Num),
	column: Type.Optional(Num),
};
export const Warning = Obj(WarningFields);
export type Warning = Static<typeof Warning>;
const SettingsScope = Type.Union([Type.Literal("global"), Type.Literal("project")]);

/** Steers already went to the running turn and cannot be taken back; queued inputs wait for an idle thread. */
const QueueEntry = Obj({ id: Str, text: Str });
export const TurnQueue = Obj({ steering: Type.Array(Str), followUp: Type.Array(QueueEntry) });
export type TurnQueue = Static<typeof TurnQueue>;

export const ClientRequests = {
	initialize: {
		params: Obj({
			clientInfo: Obj({ name: Str, version: Str }),
			capabilities: Obj({
				localHandles: Type.Optional(Bool),
				optOutNotifications: Type.Optional(Type.Array(Str, { maxItems: 256 })),
			}),
		}),
		result: Obj({
			serverInfo: Obj({ name: Type.Literal("knightcode"), version: Str }),
			platform: Platform,
		}),
	},
	"thread/start": {
		params: Obj({
			cwd: Str,
			workspace: Type.Optional(WorkspaceRequest),
			approvalMode: Type.Optional(ApprovalMode),
			model: Type.Optional(ModelSelector),
			thinkingLevel: Type.Optional(ThinkingLevel),
		}),
		result: Obj({ thread: Thread, warnings: Type.Array(Warning) }),
	},
	"thread/resume": {
		params: Obj({ threadId: Str, cursor: Type.Optional(Str) }),
		result: Obj({
			thread: Thread,
			queue: TurnQueue,
			usage: TokenUsage,
			warnings: Type.Array(Warning),
			turns: Type.Array(WireTurn),
			runningTurn: Type.Optional(WireTurn),
			nextCursor: Type.Optional(Str),
		}),
	},
	"thread/fork": {
		params: Obj({
			threadId: Str,
			atItemId: Type.Optional(Str),
			/** Absent: the fork shares the source's workspace. */
			workspace: Type.Optional(Obj({ mode: Type.Literal("worktree") })),
		}),
		result: Obj({ thread: Thread, warnings: Type.Array(Warning) }),
	},
	"thread/handoff": {
		params: Obj({
			threadId: Str,
			to: Type.Union([Type.Literal("local"), Type.Literal("worktree")]),
			branch: Type.Optional(BranchName),
			environment: Type.Optional(Str),
		}),
		result: Obj({ thread: Thread, branch: Type.Optional(Str), warnings: Type.Array(Warning) }),
	},
	"thread/worktree/restore": { params: ThreadId, result: Obj({ thread: Thread }) },
	"worktree/list": {
		params: Obj({ cwd: Type.Optional(Str) }),
		result: Obj({
			worktrees: Type.Array(
				Obj({
					path: Str,
					projectCwd: Str,
					head: Type.Optional(Str),
					branch: Type.Optional(Str),
					threadIds: Type.Array(Str),
					lastUsedAt: Num,
					deleted: Bool,
				}),
			),
		}),
	},
	"worktree/delete": { params: Obj({ path: Str }), result: Obj({ snapshot: Type.Optional(Str) }) },
	"environment/list": {
		params: Obj({ cwd: Str }),
		result: Obj({ environments: Type.Array(Environment), trusted: Bool }),
	},
	"environment/save": {
		params: Obj({ cwd: Str, environments: Type.Array(Environment, { maxItems: 50 }) }),
		result: Empty,
	},
	"thread/diff/read": {
		params: Obj({
			threadId: Str,
			...ScopeSelector,
			context: Type.Optional(ReadContext),
			ignoreWhitespace: Type.Optional(Bool),
		}),
		result: Obj({
			scope: DiffScope,
			files: Type.Array(DiffFile),
			filesOmitted: Type.Optional(Num),
			untrackedSkipped: Type.Optional(Num),
			turnId: Type.Optional(Str),
			stale: Type.Optional(Bool),
			against: Type.Optional(Str),
		}),
	},
	"thread/diff/revert": {
		params: Obj({
			...DiffTarget,
			...ScopeSelector,
			/** `lastTurn` only: apply the turn's changes again after an undo (Codex's Reapply). */
			reapply: Type.Optional(Bool),
		}),
		result: Obj({ paths: Type.Array(Str) }),
	},
	"git/status": {
		params: ThreadId,
		result: Obj({
			branch: Type.Optional(Str),
			head: Type.Optional(Str),
			upstream: Type.Optional(Str),
			ahead: Num,
			behind: Num,
			staged: Num,
			unstaged: Num,
			untracked: Num,
			conflicted: Num,
			operation: Type.Optional(
				Type.Union([Type.Literal("merge"), Type.Literal("rebase"), Type.Literal("cherryPick"), Type.Literal("revert")]),
			),
		}),
	},
	"git/stage": { params: Obj(DiffTarget), result: Obj({ paths: Type.Array(Str) }) },
	"git/unstage": { params: Obj(DiffTarget), result: Obj({ paths: Type.Array(Str) }) },
	"git/commit": {
		params: Obj({
			threadId: Str,
			message: Type.Optional(Type.String({ maxLength: 20000 })),
			/** Codex's "Include unstaged changes"; default true. */
			includeUnstaged: Type.Optional(Bool),
		}),
		result: Obj({ commit: Str, message: Str }),
	},
	"git/push": { params: ThreadId, result: Obj({ remote: Str, branch: Str, setUpstream: Bool }) },
	"git/pr/create": {
		params: Obj({ threadId: Str, title: Type.Optional(Str), body: Type.Optional(Str), draft: Type.Optional(Bool) }),
		result: Obj({ url: Str }),
	},
	"git/branch/create": { params: Obj({ threadId: Str, name: BranchName }), result: Obj({ branch: Str }) },
	"git/branch/switch": { params: Obj({ threadId: Str, name: BranchName }), result: Obj({ branch: Str }) },
	"git/branches": {
		/** A project cwd lists branches before any thread exists (the new-chat branch picker). */
		params: Type.Union([ThreadId, Obj({ cwd: Str })]),
		result: Obj({ current: Type.Optional(Str), defaultBranch: Type.Optional(Str), branches: Type.Array(Str) }),
	},
	"git/log": {
		params: Obj({ threadId: Str, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }),
		result: Obj({
			base: Type.Optional(Str),
			commits: Type.Array(Obj({ sha: Str, subject: Str, author: Str, time: Num })),
		}),
	},
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
	"thread/unsubscribe": {
		params: ThreadId,
		result: Obj({ status: Type.Union([Type.Literal("unsubscribed"), Type.Literal("notSubscribed")]) }),
	},
	"thread/delete": { params: ThreadId, result: Empty },
	"thread/archive": {
		params: ThreadId,
		result: Obj({
			worktree: Type.Optional(
				Obj({
					deleted: Bool,
					snapshot: Type.Optional(Str),
					reason: Type.Optional(
						Type.Union([
							Type.Literal("autoDeleteOff"),
							Type.Literal("inUse"),
							Type.Literal("notManaged"),
							Type.Literal("submodules"),
						]),
					),
				}),
			),
		}),
	},
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
			images: Type.Optional(Type.Array(ImageInput)),
			clientMessageId: Type.Optional(ClientMessageId),
			requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
			comments: Comments,
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
	"turn/steer": {
		params: Obj({ threadId: Str, expectedTurnId: Str, text: Str, images: Type.Optional(Type.Array(ImageInput)) }),
		result: Empty,
	},
	"turn/queue/add": {
		params: Obj({
			threadId: Str,
			text: Str,
			images: Type.Optional(Type.Array(ImageInput)),
			clientMessageId: Type.Optional(ClientMessageId),
			comments: Comments,
		}),
		result: Obj({ queueId: Str }),
	},
	"turn/queue/remove": { params: Obj({ threadId: Str, queueId: Str }), result: Obj({ removed: Bool }) },
	"turn/interrupt": { params: Obj({ threadId: Str, turnId: Type.Optional(Str) }), result: Empty },
	"file/search": {
		params: Obj({
			cwd: Str,
			query: Type.String({ minLength: 1, maxLength: 256 }),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
			searchId: Type.Optional(Type.String({ maxLength: 128 })),
		}),
		result: Obj({ files: Type.Array(Obj({ path: Str, score: Num, indices: Type.Array(Num) })), truncated: Bool }),
	},
	"model/list": {
		params: Empty,
		result: Obj({ models: Type.Array(ModelInfo), default: Type.Union([Str, Type.Null()]) }),
	},
	"server/diagnostics": {
		params: Empty,
		result: Obj({
			rssBytes: Num,
			heapBytes: Num,
			loadedThreads: Num,
			loadingThreads: Num,
			payloadFiles: Num,
			payloadBytes: Num,
			inactiveFactories: Num,
			uptimeMs: Num,
			listingFilesOpened: Num,
			listingBytesScanned: Num,
		}),
	},
	"command/list": {
		params: Type.Union([ThreadId, Obj({ cwd: Str })]),
		result: Obj({ commands: Type.Array(Obj({ name: Str, description: Str })) }),
	},
	"config/read": {
		params: Obj({ cwd: Type.Optional(Str) }),
		result: Obj({
			settings: Type.Unknown(),
			origins: Type.Record(Str, SettingsScope),
			versions: Obj({ global: Str, project: Type.Optional(Str) }),
			errors: Type.Array(Warning),
		}),
	},
	"config/write": {
		params: Obj({
			scope: SettingsScope,
			cwd: Type.Optional(Str),
			key: Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*$" }),
			value: Type.Unknown(),
			expectedVersion: Type.Optional(Str),
		}),
		result: Obj({ version: Str }),
	},
	"project/trust/read": {
		params: Obj({ cwd: Str }),
		result: Obj({ trusted: Type.Union([Bool, Type.Null()]), needsTrust: Bool }),
	},
	"project/trust/set": { params: Obj({ cwd: Str, trusted: Bool }), result: Empty },
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
	"thread/deleted": Obj({ threadId: Str }),
	/** Files whose content changed while the turn ran; not only the turn's own edits (§6.2). */
	"turn/diff/updated": Obj({ threadId: Str, turnId: Str, files: Type.Array(TurnFile) }),
	"thread/workspace/progress": Obj({
		threadId: Str,
		phase: Type.Union([Type.Literal("setup"), Type.Literal("cleanup")]),
		output: Str,
	}),
	"thread/turn/completed": Obj({ turn: TurnSummary }),
	"turn/started": Obj({ turn: Turn, requestId: Type.Optional(Str) }),
	"turn/completed": Obj({ turn: TurnSummary }),
	"turn/retry": Obj({ threadId: Str, turnId: Str, attempt: Num, maxAttempts: Num, delayMs: Num, error: Str }),
	"thread/tokenUsage/updated": Obj({ threadId: Str, turnId: Str, usage: TokenUsage }),
	"turn/queue/updated": Obj({ threadId: Str, steering: Type.Array(Str), followUp: Type.Array(QueueEntry) }),
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
	warning: Obj({ ...WarningFields, threadId: Type.Optional(Str) }),
	error: Obj({ message: Str, threadId: Type.Optional(Str) }),
} as const;

const ApprovalDecisionKind = Type.Union([
	Type.Literal("accept"),
	Type.Literal("acceptForSession"),
	Type.Literal("acceptPrefixForSession"),
	Type.Literal("decline"),
]);
const ApprovalCommon = {
	threadId: Str,
	turnId: Str,
	itemId: Str,
	tool: Str,
	parentItemId: Type.Optional(Str),
	reason: Type.Optional(Str),
	prefix: Type.Optional(Str),
	decisions: Type.Array(ApprovalDecisionKind),
};
export const ApprovalResult = Type.Union([
	Obj({ decision: Type.Union([Type.Literal("accept"), Type.Literal("acceptForSession"), Type.Literal("cancel")]) }),
	Obj({ decision: Type.Literal("acceptPrefixForSession") }),
	Obj({ decision: Type.Literal("decline"), message: Type.Optional(Type.String({ maxLength: 4000 })) }),
]);
export type ApprovalResult = Static<typeof ApprovalResult>;

export const ServerRequests = {
	"item/toolCall/requestApproval": {
		params: Type.Union([
			Obj({ ...ApprovalCommon, input: Type.Unknown() }),
			Obj({ ...ApprovalCommon, inputRef: PayloadRef }),
		]),
		result: ApprovalResult,
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
		envelope: Envelope,
		clientRequests: ClientRequests,
		clientNotifications: ClientNotifications,
		serverNotifications: ServerNotifications,
		serverRequests: ServerRequests,
	};
}
