// The records every KnightCode Bots client and the Worker exchange, as TypeBox schemas.
import { type Static, type TSchema, Type } from "typebox";
import { AvatarSchema } from "./avatars.ts";

const Id = Type.String({ minLength: 1 });
/** Milliseconds since the Unix epoch. */
const Time = Type.Number();
const Json = Type.Unknown();
const Opt = <T extends TSchema>(schema: T) => Type.Optional(schema);
const Lit = <const V extends string[]>(values: readonly [...V]) => Type.Enum(values);

// ─── Shared values ──────────────────────────────────────────────────────────

/** A model chosen by the user: provider id, model id and an optional thinking level. Never a constant. */
export const ModelRefSchema = Type.Object({ provider: Id, modelId: Id, thinking: Opt(Type.String()) });
export type ModelRef = Static<typeof ModelRefSchema>;

export const ApprovalModeSchema = Lit(["never", "auto", "ask"] as const);
export type ApprovalMode = Static<typeof ApprovalModeSchema>;

/** When a bot notifies the user. */
export const NotifySchema = Lit(["finish", "input", "never"] as const);
export type Notify = Static<typeof NotifySchema>;

export const PermissionLevelSchema = Lit(["auto", "approval", "blocked"] as const);
export type PermissionLevel = Static<typeof PermissionLevelSchema>;

export const FileKindSchema = Lit(["attachment", "bot-output", "knowledge"] as const);
export type FileKind = Static<typeof FileKindSchema>;

export const FileRefSchema = Type.Object({
	id: Id,
	name: Type.String(),
	size: Type.Number(),
	mime: Type.String(),
	kind: FileKindSchema,
	botId: Opt(Id),
	createdAt: Time,
});
export type FileRef = Static<typeof FileRefSchema>;

// ─── Account ────────────────────────────────────────────────────────────────

export const PlanStateSchema = Lit(["none", "trial", "active", "lapsed"] as const);
export type PlanState = Static<typeof PlanStateSchema>;

export const AccountSchema = Type.Object({
	id: Id,
	workspaceId: Id,
	name: Type.String(),
	email: Opt(Type.String()),
	/** Lowercase letters, digits and hyphens, 3 to 20 characters; absent until chosen. */
	handle: Opt(Type.String()),
	timeZone: Type.String(),
	plan: PlanStateSchema,
	/** The model new bots start with, chosen by the user. There is no built-in default. */
	defaultModel: Opt(ModelRefSchema),
	/** Helper models the user picked; each falls back to the bot's own model, or `defaultModel` outside a bot. */
	helperModels: Type.Object({
		memory: Opt(ModelRefSchema),
		catchUp: Opt(ModelRefSchema),
		groupJudge: Opt(ModelRefSchema),
	}),
	createdAt: Time,
});
export type Account = Static<typeof AccountSchema>;

/** A handle, or the bot part of a bot's email address: lowercase letters, digits and hyphens, 3 to 20 characters. */
export const NAME_PATTERN = /^[a-z0-9-]{3,20}$/;

/** Names no handle or bot address may take (spec section 10). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
	"abuse",
	"admin",
	"administrator",
	"billing",
	"help",
	"hostmaster",
	"info",
	"knightcode",
	"mailer-daemon",
	"no-reply",
	"noreply",
	"official",
	"postmaster",
	"root",
	"security",
	"staff",
	"support",
	"system",
	"webmaster",
]);

/** Checks a handle or bot address part against the shape and reserved-name rules. */
export function checkName(name: string): "ok" | "invalid" | "reserved" {
	if (!NAME_PATTERN.test(name)) return "invalid";
	return RESERVED_NAMES.has(name) ? "reserved" : "ok";
}

export const SignInMethodSchema = Type.Object({
	kind: Lit(["github", "google", "email", "passkey"] as const),
	label: Type.String(),
});
export type SignInMethod = Static<typeof SignInMethodSchema>;

export const PasskeySchema = Type.Object({ id: Id, name: Type.String(), createdAt: Time, lastUsedAt: Opt(Time) });
export type Passkey = Static<typeof PasskeySchema>;

/** A model provider the user can connect, and whether the cloud holds a working credential for it. */
export const ProviderConnectionSchema = Type.Object({
	provider: Id,
	name: Type.String(),
	kind: Lit(["oauth", "api_key"] as const),
	status: Lit(["connected", "reconnect", "available", "unavailable"] as const),
	/** One line shown under the provider, such as how its usage is billed. */
	note: Opt(Type.String()),
});
export type ProviderConnection = Static<typeof ProviderConnectionSchema>;

/** A model the user's connected providers offer. */
export const ModelOptionSchema = Type.Object({
	provider: Id,
	modelId: Id,
	name: Type.String(),
	thinking: Type.Array(Type.String()),
	images: Type.Boolean(),
});
export type ModelOption = Static<typeof ModelOptionSchema>;

export const OnboardingItemSchema = Type.Object({
	id: Lit(["providers", "bot", "app", "approvals", "chat-app"] as const),
	done: Type.Boolean(),
});
export const OnboardingSchema = Type.Object({ items: Type.Array(OnboardingItemSchema) });
export type Onboarding = Static<typeof OnboardingSchema>;

// ─── Bots and groups ────────────────────────────────────────────────────────

export const BotStatusSchema = Lit(["idle", "working", "sleeping"] as const);
export type BotStatus = Static<typeof BotStatusSchema>;

export const BotSchema = Type.Object({
	id: Id,
	name: Type.String({ minLength: 1 }),
	/** The one-line "what I'm for" other bots read. */
	purpose: Type.String(),
	instructions: Type.String(),
	instructionsVersion: Type.Number(),
	model: ModelRefSchema,
	avatar: AvatarSchema,
	/** The bot's approval mode, or "default" for the user's. */
	approvals: Type.Union([ApprovalModeSchema, Type.Literal("default")]),
	computerAccess: Type.Boolean(),
	notify: NotifySchema,
	suggestions: Type.Boolean(),
	showTools: Type.Boolean(),
	appIds: Type.Array(Id),
	status: BotStatusSchema,
	pinned: Type.Boolean(),
	archived: Type.Boolean(),
	sectionId: Opt(Id),
	unread: Type.Number(),
	needsYou: Type.Boolean(),
	/** The bot that manages this one, when a manager created it or was assigned it. */
	managedBy: Opt(Id),
	email: Opt(Type.String()),
	lastActivityAt: Opt(Time),
	createdAt: Time,
});
export type Bot = Static<typeof BotSchema>;

export const GroupSchema = Type.Object({
	id: Id,
	name: Type.String({ minLength: 1 }),
	memberIds: Type.Array(Id, { minItems: 2, maxItems: 10 }),
	leadId: Id,
	turnBudget: Type.Number(),
	pinned: Type.Boolean(),
	unread: Type.Number(),
	needsYou: Type.Boolean(),
	createdAt: Time,
});
export type Group = Static<typeof GroupSchema>;

/** A named sidebar section holding bots and groups in order. */
export const SectionSchema = Type.Object({ id: Id, name: Type.String(), itemIds: Type.Array(Id) });
export type Section = Static<typeof SectionSchema>;

export const InstructionsVersionSchema = Type.Object({
	version: Type.Number(),
	text: Type.String(),
	createdAt: Time,
	/** "You", or the bot that made the change ("Updated by <bot>"). */
	author: Type.Union([
		Type.Object({ kind: Type.Literal("user") }),
		Type.Object({ kind: Type.Literal("bot"), botId: Id }),
	]),
});
export type InstructionsVersion = Static<typeof InstructionsVersionSchema>;

export const TemplateSchema = Type.Object({
	id: Id,
	name: Type.String(),
	area: Type.String(),
	description: Type.String(),
	instructions: Type.String(),
	avatar: AvatarSchema,
	connectors: Type.Array(Id),
	routines: Type.Array(Type.Object({ name: Type.String(), prompt: Type.String() })),
});
export type Template = Static<typeof TemplateSchema>;

// ─── Memory ─────────────────────────────────────────────────────────────────

export const NoteSchema = Type.Object({
	name: Id,
	description: Type.String(),
	type: Lit(["fact", "preference", "decision", "reference"] as const),
	body: Type.String(),
	updatedAt: Time,
	shared: Type.Boolean(),
	/** Written by a run that outside text started or entered. */
	outside: Type.Boolean(),
});
export type Note = Static<typeof NoteSchema>;

export const OpenWorkItemSchema = Type.Object({ id: Id, text: Type.String(), done: Type.Boolean(), createdAt: Time });
export type OpenWorkItem = Static<typeof OpenWorkItemSchema>;

// ─── Routines, triggers and grants ──────────────────────────────────────────

/** What a routine may do when outside text starts its run (spec section 24). */
export const GrantSchema = Type.Object({
	actions: Type.Array(Type.String()),
	targets: Type.Array(Type.String()),
	limits: Type.Object({ perDay: Opt(Type.Number()), perRun: Opt(Type.Number()) }),
});
export type Grant = Static<typeof GrantSchema>;

export const TriggerSchema = Type.Union([
	/** A cron expression, or one firing at `at` (a reminder). */
	Type.Object({ kind: Type.Literal("schedule"), cron: Opt(Type.String()), at: Opt(Time), timeZone: Type.String() }),
	Type.Object({
		kind: Type.Literal("github"),
		repo: Type.String(),
		events: Type.Array(Type.String()),
		branch: Opt(Type.String()),
		users: Opt(Type.Array(Type.String())),
	}),
	Type.Object({
		kind: Type.Literal("slack"),
		channel: Opt(Type.String()),
		match: Lit(["mention", "keyword", "reaction", "any"] as const),
		keyword: Opt(Type.String()),
		emoji: Opt(Type.String()),
		ownReactionsOnly: Opt(Type.Boolean()),
	}),
	Type.Object({ kind: Type.Literal("email"), from: Opt(Type.String()), allowUnauthenticated: Opt(Type.Boolean()) }),
	Type.Object({ kind: Type.Literal("composio"), appId: Id, event: Type.String() }),
	/** The secret URL exists only in `mintWebhook`'s response, never in a stored routine. */
	Type.Object({ kind: Type.Literal("webhook"), id: Opt(Id) }, { additionalProperties: false }),
	Type.Object({
		kind: Type.Literal("watch"),
		target: Lit(["connector", "file", "command"] as const),
		source: Type.String(),
		everyMinutes: Type.Number({ minimum: 5 }),
		postNoChanges: Type.Boolean(),
	}),
]);
export type Trigger = Static<typeof TriggerSchema>;
export type TriggerKind = Trigger["kind"];

export const RoutineSchema = Type.Object({
	id: Id,
	botId: Id,
	name: Type.String({ minLength: 1 }),
	prompt: Type.String(),
	triggers: Type.Array(TriggerSchema),
	grant: GrantSchema,
	active: Type.Boolean(),
	model: Opt(ModelRefSchema),
	/** Kept from an import: the trigger descriptions the recipe had no field for. */
	note: Opt(Type.String()),
	lastRunAt: Opt(Time),
	nextRunAt: Opt(Time),
});
export type Routine = Static<typeof RoutineSchema>;

export const RunStatusSchema = Lit(["queued", "running", "succeeded", "failed", "stopped"] as const);
export type RunStatus = Static<typeof RunStatusSchema>;

export const RunSchema = Type.Object({
	id: Id,
	botId: Id,
	routineId: Opt(Id),
	title: Type.String(),
	startedBy: Lit(["user", "routine", "email", "webhook", "channel", "bot"] as const),
	status: RunStatusSchema,
	startedAt: Time,
	endedAt: Opt(Time),
	summary: Opt(Type.String()),
	/** A catch-up run started after its scheduled time. */
	late: Opt(Type.Boolean()),
});
export type Run = Static<typeof RunSchema>;

// ─── Connectors and skills ──────────────────────────────────────────────────

export const CATALOG_CATEGORIES = [
	"developer",
	"productivity",
	"google-workspace",
	"microsoft-365",
	"crm-sales",
	"marketing-social",
	"seo",
	"support",
	"hr",
	"finance",
	"data",
] as const;
export const CatalogCategorySchema = Lit(CATALOG_CATEGORIES);
export type CatalogCategory = Static<typeof CatalogCategorySchema>;

export const ConnectorPermissionsSchema = Type.Object({
	reads: PermissionLevelSchema,
	writes: PermissionLevelSchema,
	tools: Type.Record(Type.String(), PermissionLevelSchema),
});
export type ConnectorPermissions = Static<typeof ConnectorPermissionsSchema>;

/** One app in the catalog. Deliberately has no field for where the entry came from. */
export const CatalogEntrySchema = Type.Object({
	id: Id,
	name: Type.String(),
	maker: Type.String(),
	category: CatalogCategorySchema,
	icon: Type.String(),
	description: Type.String(),
	auth: Lit(["oauth", "api_key", "none"] as const),
	skills: Type.Array(Type.Object({ name: Type.String(), description: Type.String() })),
	/** At most 500 characters; the bot always follows it when using the app. */
	usageNote: Opt(Type.String({ maxLength: 500 })),
	permissions: ConnectorPermissionsSchema,
	/** One line naming a third party that processes this app's data, when one does. */
	notice: Opt(Type.String()),
	connection: Opt(Type.Object({ status: Lit(["connected", "reconnect", "off"] as const), connectedAt: Time })),
});
export type CatalogEntry = Static<typeof CatalogEntrySchema>;

export const SkillScopeSchema = Lit(["user", "bot", "app", "catalog"] as const);
export type SkillScope = Static<typeof SkillScopeSchema>;

export const SkillSchema = Type.Object({
	id: Id,
	name: Type.String({ minLength: 1 }),
	/** When to use it, in one line. */
	description: Type.String(),
	content: Type.String(),
	scope: SkillScopeSchema,
	botId: Opt(Id),
	appId: Opt(Id),
	updatedAt: Time,
});
export type Skill = Static<typeof SkillSchema>;

export const SkillDraftSchema = Type.Object({
	name: Type.String(),
	description: Type.String(),
	content: Type.String(),
});
export type SkillDraft = Static<typeof SkillDraftSchema>;

// ─── Pages ──────────────────────────────────────────────────────────────────

/** A declarative chart the client renders; never code. */
export const ChartSpecSchema = Type.Object({
	kind: Lit(["line", "bar", "area", "pie"] as const),
	title: Opt(Type.String()),
	labels: Type.Array(Type.String()),
	series: Type.Array(Type.Object({ name: Type.String(), values: Type.Array(Type.Number()) })),
});
export type ChartSpec = Static<typeof ChartSpecSchema>;

const Cell = Type.Union([Type.String(), Type.Number(), Type.Null()]);

export const PageBlockSchema = Type.Union([
	/** Rich text as Markdown; rendered without raw HTML. */
	Type.Object({ type: Type.Literal("text"), id: Id, text: Type.String() }),
	Type.Object({
		type: Type.Literal("table"),
		id: Id,
		columns: Type.Array(Type.String()),
		rows: Type.Array(Type.Array(Cell)),
	}),
	Type.Object({ type: Type.Literal("chart"), id: Id, spec: ChartSpecSchema }),
	Type.Object({ type: Type.Literal("image"), id: Id, fileId: Id, alt: Type.String() }),
	Type.Object({ type: Type.Literal("file"), id: Id, fileId: Id, name: Type.String() }),
	Type.Object({
		type: Type.Literal("widget"),
		id: Id,
		title: Type.String(),
		source: Type.Object({ kind: Lit(["routine", "connector", "file"] as const), ref: Type.String() }),
		view: Lit(["number", "list", "table", "chart"] as const),
		data: Opt(Json),
		refreshedAt: Opt(Time),
	}),
	Type.Object({
		type: Type.Literal("button"),
		id: Id,
		label: Type.String(),
		action: Type.Union([
			Type.Object({ kind: Type.Literal("routine"), routineId: Id }),
			Type.Object({
				kind: Type.Literal("connector"),
				appId: Id,
				tool: Type.String(),
				args: Type.Record(Type.String(), Json),
			}),
		]),
	}),
]);
export type PageBlock = Static<typeof PageBlockSchema>;

export const PageSummarySchema = Type.Object({
	id: Id,
	title: Type.String(),
	ownerBotId: Id,
	pinned: Type.Boolean(),
	updatedAt: Time,
});
export type PageSummary = Static<typeof PageSummarySchema>;

export const PageSchema = Type.Object({
	...PageSummarySchema.properties,
	version: Type.Number(),
	blocks: Type.Array(PageBlockSchema),
});
export type Page = Static<typeof PageSchema>;

// ─── Inbox and tasks ────────────────────────────────────────────────────────

export const InboxKindSchema = Lit([
	"approval",
	"question",
	"takeover",
	"review",
	"failure",
	"task",
	"suggestion",
] as const);
export type InboxKind = Static<typeof InboxKindSchema>;

export const InboxItemSchema = Type.Object({
	id: Id,
	kind: InboxKindSchema,
	botId: Id,
	title: Type.String(),
	detail: Opt(Type.String()),
	/** The chat entry this item links to. */
	entryId: Opt(Id),
	approvalId: Opt(Id),
	createdAt: Time,
	pinned: Type.Boolean(),
	done: Type.Boolean(),
	read: Type.Boolean(),
});
export type InboxItem = Static<typeof InboxItemSchema>;

export const TaskSchema = Type.Object({
	id: Id,
	title: Type.String(),
	ownerBotId: Opt(Id),
	status: Lit(["open", "done"] as const),
	due: Opt(Time),
	source: Lit(["user", "bot", "open-work"] as const),
	createdAt: Time,
});
export type Task = Static<typeof TaskSchema>;

/** "While you were away": what finished, waits and failed across bots. */
export const CatchUpSchema = Type.Object({
	since: Time,
	summary: Type.String(),
	finished: Type.Array(InboxItemSchema),
	waiting: Type.Array(InboxItemSchema),
	failed: Type.Array(InboxItemSchema),
});
export type CatchUp = Static<typeof CatchUpSchema>;

// ─── Approvals ──────────────────────────────────────────────────────────────

export const ApprovalStateSchema = Lit(["pending", "allowed", "denied", "expired"] as const);
export type ApprovalState = Static<typeof ApprovalStateSchema>;

/** A pending decision on one exact action, consumed once (spec section 24). */
export const ApprovalSchema = Type.Object({
	id: Id,
	botId: Id,
	/** SHA-256 of the canonical action. */
	digest: Type.String(),
	action: Type.Object({
		tool: Type.String(),
		title: Type.String(),
		target: Opt(Type.String()),
		/** The full change, for instruction or model edits. */
		change: Opt(Type.Object({ before: Type.String(), after: Type.String() })),
		spend: Opt(
			Type.Object({ merchant: Type.String(), amount: Type.Number(), currency: Type.String(), item: Type.String() }),
		),
	}),
	expiresAt: Time,
	state: ApprovalStateSchema,
});
export type Approval = Static<typeof ApprovalSchema>;

export const RuleSchema = Type.Object({ id: Id, kind: Lit(["tool", "site"] as const), value: Type.String() });
export type Rule = Static<typeof RuleSchema>;

export const ApprovalSettingsSchema = Type.Object({
	mode: ApprovalModeSchema,
	allow: Type.Array(RuleSchema),
	block: Type.Array(RuleSchema),
	reviewer: Opt(ModelRefSchema),
});
export type ApprovalSettings = Static<typeof ApprovalSettingsSchema>;

// ─── Vault, usage, computer, channels ───────────────────────────────────────

/** Vault metadata. The value is write-only and appears in no response. */
export const VaultItemSchema = Type.Object({
	id: Id,
	kind: Lit(["api", "login", "env"] as const),
	name: Type.String({ minLength: 1 }),
	origin: Opt(Type.String()),
	injection: Opt(Lit(["bearer", "header", "basic"] as const)),
	header: Opt(Type.String()),
	createdAt: Time,
});
export type VaultItem = Static<typeof VaultItemSchema>;

export const UsageRowSchema = Type.Object({
	botId: Id,
	routineId: Opt(Id),
	model: ModelRefSchema,
	runs: Type.Number(),
	inputTokens: Type.Number(),
	outputTokens: Type.Number(),
	/** The provider's cost as reported; the user pays the provider, not KnightCode. */
	costUsd: Type.Number(),
	day: Type.String(),
});
export type UsageRow = Static<typeof UsageRowSchema>;

export const MaintenanceActionSchema = Lit(["stop", "update", "recover", "reset"] as const);
export type MaintenanceAction = Static<typeof MaintenanceActionSchema>;

export const ComputerStateSchema = Type.Object({
	status: Lit(["off", "starting", "awake", "saving", "sleeping", "restoring", "maintenance", "error"] as const),
	lastSavedAt: Opt(Time),
	generation: Opt(Type.Number()),
	screens: Type.Array(Type.Object({ botId: Id, controller: Lit(["bot", "user", "none"] as const) })),
	job: Opt(Type.Object({ action: MaintenanceActionSchema, progress: Type.Number() })),
	hoursUsed: Type.Number(),
	hoursIncluded: Type.Number(),
});
export type ComputerState = Static<typeof ComputerStateSchema>;

export const ChannelLinkSchema = Type.Object({
	id: Id,
	channel: Lit(["telegram", "slack", "email"] as const),
	botId: Id,
	externalId: Type.String(),
	label: Type.String(),
	/** For group conversations. */
	mode: Opt(Lit(["mentions", "listen"] as const)),
	rules: Opt(Type.String()),
	createdAt: Time,
});
export type ChannelLink = Static<typeof ChannelLinkSchema>;

export const ChannelsSchema = Type.Object({
	links: Type.Array(ChannelLinkSchema),
	slackInstalled: Type.Boolean(),
	addresses: Type.Array(Type.Object({ botId: Id, address: Type.String() })),
});
export type Channels = Static<typeof ChannelsSchema>;

// ─── Billing, payments, finance, routing ────────────────────────────────────

export const ReceiptSchema = Type.Object({
	id: Id,
	at: Time,
	amount: Type.Number(),
	/** The payment processor's actual fee, deducted before credits are converted. */
	fee: Type.Number(),
	credited: Type.Number(),
});
export type Receipt = Static<typeof ReceiptSchema>;

export const BillingSchema = Type.Object({
	plan: PlanStateSchema,
	trialEndsAt: Opt(Time),
	renewsAt: Opt(Time),
	computerHours: Type.Object({ used: Type.Number(), included: Type.Number() }),
	storage: Type.Object({ usedBytes: Type.Number(), includedBytes: Type.Number() }),
	credits: Type.Number(),
	spendingLimit: Type.Union([Type.Number(), Type.Null()]),
	autoTopUp: Type.Object({ enabled: Type.Boolean(), threshold: Opt(Type.Number()), amount: Opt(Type.Number()) }),
	receipts: Type.Array(ReceiptSchema),
});
export type Billing = Static<typeof BillingSchema>;

export const SpendLimitSchema = Type.Object({ botId: Id, perPurchase: Type.Number(), perMonth: Type.Number() });
export type SpendLimit = Static<typeof SpendLimitSchema>;

export const PaymentsSchema = Type.Object({
	available: Type.Boolean(),
	linked: Type.Boolean(),
	limits: Type.Array(SpendLimitSchema),
});
export type Payments = Static<typeof PaymentsSchema>;

export const FinanceSchema = Type.Object({
	available: Type.Boolean(),
	accounts: Type.Array(
		Type.Object({
			id: Id,
			name: Type.String(),
			type: Lit(["bank", "card", "loan", "brokerage"] as const),
			mask: Type.String(),
			balance: Type.Number(),
			currency: Type.String(),
		}),
	),
});
export type Finance = Static<typeof FinanceSchema>;

export const HomeRoutingSchema = Type.Object({
	enabled: Type.Boolean(),
	route: Lit(["desktop", "tailscale"] as const),
	failClosed: Type.Boolean(),
	allowedPrivateHosts: Type.Array(Type.String()),
});
export type HomeRouting = Static<typeof HomeRoutingSchema>;

export const TailscaleSchema = Type.Object({
	joined: Type.Boolean(),
	hasKey: Type.Boolean(),
	exitNode: Opt(Type.String()),
});
export type Tailscale = Static<typeof TailscaleSchema>;

export const OnePasswordSchema = Type.Object({ connected: Type.Boolean(), account: Opt(Type.String()) });
export type OnePassword = Static<typeof OnePasswordSchema>;

// ─── Conversations ──────────────────────────────────────────────────────────

export const ReactionSchema = Type.Object({ emoji: Type.String(), count: Type.Number(), mine: Type.Boolean() });

export const CardSchema = Type.Union([
	Type.Object({
		type: Type.Literal("question"),
		question: Type.String(),
		choices: Type.Array(Type.String()),
		allowOther: Type.Boolean(),
		answer: Opt(Type.String()),
	}),
	Type.Object({ type: Type.Literal("approval"), approval: ApprovalSchema }),
	Type.Object({
		type: Type.Literal("takeover"),
		reason: Type.String(),
		state: Lit(["requested", "active", "released"] as const),
	}),
	Type.Object({
		type: Type.Literal("suggestion"),
		suggestionId: Id,
		text: Type.String(),
		state: Lit(["open", "accepted", "dismissed"] as const),
	}),
	Type.Object({
		type: Type.Literal("helper"),
		title: Type.String(),
		state: Lit(["running", "completed", "failed"] as const),
		result: Opt(Type.String()),
	}),
	Type.Object({
		type: Type.Literal("skill-draft"),
		draft: SkillDraftSchema,
		state: Lit(["draft", "saved", "discarded"] as const),
	}),
	Type.Object({
		type: Type.Literal("settings-change"),
		field: Type.String(),
		before: Type.String(),
		after: Type.String(),
		undone: Type.Boolean(),
	}),
	Type.Object({
		type: Type.Literal("secret-request"),
		name: Type.String(),
		origin: Type.String(),
		kind: Lit(["api", "login", "env"] as const),
		state: Lit(["open", "saved", "dismissed"] as const),
	}),
	Type.Object({ type: Type.Literal("run-setup"), skill: Type.String() }),
	/** An interactive panel from an MCP server, served from the sandbox origin. */
	Type.Object({ type: Type.Literal("app-panel"), appId: Id, title: Type.String(), appUrl: Type.String() }),
]);
export type Card = Static<typeof CardSchema>;

/** One visible row of a thread. Internal runs and tool lifecycle are not entries. */
export const EntrySchema = Type.Union([
	Type.Object({
		kind: Type.Literal("message"),
		id: Id,
		role: Lit(["user", "assistant"] as const),
		/** The speaking bot, in group chats. */
		botId: Opt(Id),
		text: Type.String(),
		createdAt: Time,
		streaming: Opt(Type.Boolean()),
		attachments: Opt(Type.Array(FileRefSchema)),
		replyTo: Opt(Id),
		quote: Opt(Type.String()),
		reactions: Opt(Type.Array(ReactionSchema)),
		/** Present only when the bot's "Show tools used" setting is on. */
		tools: Opt(Type.Array(Type.String())),
	}),
	Type.Object({ kind: Type.Literal("card"), id: Id, botId: Opt(Id), createdAt: Time, card: CardSchema }),
	/** "Messaged <bot>" or "Message from <bot>"; opening it shows the exchange read-only. */
	Type.Object({
		kind: Type.Literal("bot-message"),
		id: Id,
		direction: Lit(["to", "from"] as const),
		peerBotId: Id,
		intent: Lit(["request", "question", "status", "result"] as const),
		text: Type.String(),
		createdAt: Time,
	}),
	/** A group turn a bot passed on. */
	Type.Object({
		kind: Type.Literal("turn"),
		id: Id,
		botId: Id,
		outcome: Lit(["pass", "timeout"] as const),
		createdAt: Time,
	}),
	Type.Object({ kind: Type.Literal("event"), id: Id, text: Type.String(), createdAt: Time }),
]);
export type Entry = Static<typeof EntrySchema>;

/** The live state of one thread: what `view` frames carry and `ops` frames patch. */
export const ConversationViewSchema = Type.Object({
	entries: Type.Array(EntrySchema),
	running: Type.Boolean(),
	/** Entries before the first one here exist and are paged through the history route. */
	hasEarlier: Type.Boolean(),
});
export type ConversationView = Static<typeof ConversationViewSchema>;

export const SearchHitSchema = Type.Object({
	kind: Lit(["bot", "group", "message", "page", "skill"] as const),
	id: Id,
	botId: Opt(Id),
	groupId: Opt(Id),
	title: Type.String(),
	snippet: Opt(Type.String()),
});
export type SearchHit = Static<typeof SearchHitSchema>;
