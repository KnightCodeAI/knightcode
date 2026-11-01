// Every HTTP call a KnightCode Bots client makes, as one table, plus the typed client and the server-side matcher.
import { type Static, type TObject, type TProperties, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import {
	AccountSchema,
	ApprovalSchema,
	ApprovalSettingsSchema,
	BillingSchema,
	BotSchema,
	CatalogCategorySchema,
	CatalogEntrySchema,
	CatchUpSchema,
	ChannelLinkSchema,
	ChannelsSchema,
	ComputerStateSchema,
	ConnectorPermissionsSchema,
	ConversationViewSchema,
	FileKindSchema,
	FileRefSchema,
	FinanceSchema,
	GrantSchema,
	GroupSchema,
	HomeRoutingSchema,
	InboxItemSchema,
	InstructionsVersionSchema,
	MaintenanceActionSchema,
	ModelOptionSchema,
	ModelRefSchema,
	NoteSchema,
	OnboardingSchema,
	OnePasswordSchema,
	OpenWorkItemSchema,
	PageBlockSchema,
	PageSchema,
	PageSummarySchema,
	PasskeySchema,
	PaymentsSchema,
	ProviderConnectionSchema,
	RoutineSchema,
	RunSchema,
	RunStatusSchema,
	SearchHitSchema,
	SectionSchema,
	SignInMethodSchema,
	SkillDraftSchema,
	SkillSchema,
	SkillScopeSchema,
	SpendLimitSchema,
	TailscaleSchema,
	TaskSchema,
	TemplateSchema,
	TriggerSchema,
	UsageRowSchema,
	VaultItemSchema,
} from "./entities.ts";
import { AvatarSchema } from "./avatars.ts";
import { RecipeSchema } from "./recipe.ts";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** One HTTP call. Path params (`:name`) are fields of `request`; GET and DELETE send the rest as the query. */
export interface RouteDef<N extends string = string, Q extends TObject = TObject, S extends TSchema = TSchema> {
	readonly name: N;
	readonly method: HttpMethod;
	readonly path: string;
	readonly request: Q;
	readonly response: S;
}

const route = <N extends string, Q extends TObject, S extends TSchema>(
	name: N,
	method: HttpMethod,
	path: string,
	request: Q,
	response: S,
): RouteDef<N, Q, S> => ({ name, method, path, request, response });

const Id = Type.String({ minLength: 1 });
const Opt = <T extends TSchema>(schema: T) => Type.Optional(schema);
const Obj = <P extends TProperties>(properties: P) => Type.Object(properties);
const None = Obj({});
const Ok = Obj({ ok: Type.Literal(true) });
const Url = Obj({ url: Type.String(), expiresAt: Opt(Type.Number()) });

const BotFields = Type.Partial(
	Type.Pick(BotSchema, [
		"name",
		"purpose",
		"instructions",
		"model",
		"avatar",
		"approvals",
		"computerAccess",
		"notify",
		"suggestions",
		"showTools",
		"pinned",
		"sectionId",
	]),
).properties;
const RoutineFields = Type.Pick(RoutineSchema, [
	"name",
	"prompt",
	"triggers",
	"grant",
	"active",
	"model",
	"note",
]).properties;
const SkillFields = { name: Type.String({ minLength: 1 }), description: Type.String(), content: Type.String() };
const Selection = Type.Array(Type.Number());

export const ROUTES = [
	// Account, session, onboarding, search
	route("getAccount", "GET", "/api/account", None, AccountSchema),
	route(
		"updateAccount",
		"PATCH",
		"/api/account",
		Obj({
			name: Opt(Type.String()),
			timeZone: Opt(Type.String()),
			defaultModel: Opt(ModelRefSchema),
			helperModels: Opt(AccountSchema.properties.helperModels),
		}),
		AccountSchema,
	),
	route(
		"claimHandle",
		"POST",
		"/api/account/handle",
		Obj({ handle: Type.String() }),
		Obj({
			result: Type.Union([
				Type.Literal("ok"),
				Type.Literal("taken"),
				Type.Literal("invalid"),
				Type.Literal("reserved"),
			]),
		}),
	),
	route(
		"listSignInMethods",
		"GET",
		"/api/account/sign-in",
		None,
		Obj({ methods: Type.Array(SignInMethodSchema), passkeys: Type.Array(PasskeySchema) }),
	),
	route("beginPasskey", "POST", "/api/account/passkeys/options", None, Obj({ options: Type.Unknown() })),
	route(
		"addPasskey",
		"POST",
		"/api/account/passkeys",
		Obj({ name: Type.String(), response: Type.Unknown() }),
		PasskeySchema,
	),
	route("deletePasskey", "DELETE", "/api/account/passkeys/:id", Obj({ id: Id }), Ok),
	route("exportAccount", "POST", "/api/account/export", None, Obj({ fileId: Id })),
	route("deleteAccount", "POST", "/api/account/delete", Obj({ confirm: Type.String() }), Ok),
	route(
		"issueTicket",
		"POST",
		"/api/tickets",
		Obj({ scope: Type.Union([Type.Literal("socket"), Type.Literal("screen")]) }),
		Obj({ ticket: Type.String(), expiresAt: Type.Number() }),
	),
	route("getOnboarding", "GET", "/api/onboarding", None, OnboardingSchema),
	route("getCatchUp", "GET", "/api/catch-up", None, Obj({ catchUp: Type.Union([CatchUpSchema, Type.Null()]) })),
	route("search", "GET", "/api/search", Obj({ q: Type.String() }), Obj({ hits: Type.Array(SearchHitSchema) })),
	// Web Push: the server's VAPID public key, then this device's subscription; unsubscribing names the device's endpoint.
	route("getPushKey", "GET", "/api/push/key", None, Obj({ publicKey: Type.String() })),
	route("subscribePush", "POST", "/api/push", Obj({ subscription: Type.Unknown() }), Ok),
	route("unsubscribePush", "DELETE", "/api/push", Obj({ endpoint: Type.String() }), Ok),

	// Model providers and models
	route("listProviders", "GET", "/api/providers", None, Obj({ providers: Type.Array(ProviderConnectionSchema) })),
	route(
		"connectProvider",
		"POST",
		"/api/providers/:provider",
		Obj({ provider: Id, apiKey: Opt(Type.String()) }),
		ProviderConnectionSchema,
	),
	route("disconnectProvider", "DELETE", "/api/providers/:provider", Obj({ provider: Id }), Ok),
	/** A short-lived, single-use enrollment the desktop requests before running a provider's sign-in locally. */
	route(
		"beginEnrollment",
		"POST",
		"/api/providers/:provider/enrollment",
		Obj({ provider: Id }),
		Obj({ token: Type.String(), expiresAt: Type.Number() }),
	),
	/** Uploads the fresh sign-in's result; the desktop's own credentials are never read or sent. */
	route(
		"completeEnrollment",
		"POST",
		"/api/providers/:provider/enrollment/:token",
		Obj({ provider: Id, token: Id, credential: Type.Unknown() }),
		ProviderConnectionSchema,
	),
	route("listModels", "GET", "/api/models", None, Obj({ models: Type.Array(ModelOptionSchema) })),

	// Bots and the sidebar
	route(
		"listBots",
		"GET",
		"/api/bots",
		Obj({ archived: Opt(Type.Boolean()) }),
		Obj({ bots: Type.Array(BotSchema), groups: Type.Array(GroupSchema), sections: Type.Array(SectionSchema) }),
	),
	route(
		"createBot",
		"POST",
		"/api/bots",
		Obj({ ...BotFields, name: Type.String({ minLength: 1 }), templateId: Opt(Id) }),
		BotSchema,
	),
	route("getBot", "GET", "/api/bots/:botId", Obj({ botId: Id }), BotSchema),
	route("updateBot", "PATCH", "/api/bots/:botId", Obj({ botId: Id, ...BotFields }), BotSchema),
	route("duplicateBot", "POST", "/api/bots/:botId/duplicate", Obj({ botId: Id }), BotSchema),
	route("archiveBot", "POST", "/api/bots/:botId/archive", Obj({ botId: Id }), BotSchema),
	route("restoreBot", "POST", "/api/bots/:botId/restore", Obj({ botId: Id }), BotSchema),
	route("markUnread", "POST", "/api/bots/:botId/unread", Obj({ botId: Id, unread: Type.Boolean() }), BotSchema),
	route(
		"setSections",
		"PUT",
		"/api/sections",
		Obj({ sections: Type.Array(SectionSchema) }),
		Obj({ sections: Type.Array(SectionSchema) }),
	),
	route(
		"listInstructionVersions",
		"GET",
		"/api/bots/:botId/instructions",
		Obj({ botId: Id }),
		Obj({ versions: Type.Array(InstructionsVersionSchema) }),
	),
	route(
		"restoreInstructions",
		"POST",
		"/api/bots/:botId/instructions/restore",
		Obj({ botId: Id, version: Type.Number() }),
		BotSchema,
	),
	route("setBotApps", "PUT", "/api/bots/:botId/apps", Obj({ botId: Id, appIds: Type.Array(Id) }), BotSchema),
	route(
		"claimBotAddress",
		"PUT",
		"/api/bots/:botId/address",
		Obj({ botId: Id, local: Type.String() }),
		Obj({
			result: Type.Union([
				Type.Literal("ok"),
				Type.Literal("taken"),
				Type.Literal("invalid"),
				Type.Literal("reserved"),
			]),
			address: Opt(Type.String()),
		}),
	),
	route("listTemplates", "GET", "/api/templates", None, Obj({ templates: Type.Array(TemplateSchema) })),
	route("exportBot", "GET", "/api/bots/:botId/recipe", Obj({ botId: Id }), RecipeSchema),
	route(
		"importRecipe",
		"POST",
		"/api/import",
		Obj({
			recipe: RecipeSchema,
			origin: Type.Union([Type.Literal("self"), Type.Literal("other")]),
			/** Indexes of the ticked items in each recipe list. */
			memory: Selection,
			sharedMemory: Selection,
			skills: Selection,
			routines: Selection,
			plugins: Selection,
			/** Start the recipe's setup skill right away (the user ticked it). Its Run setup button is added either way. */
			runSetup: Type.Boolean(),
			avatar: Opt(AvatarSchema),
			/** Recipes carry no model; omitted, the account's `defaultModel` is used, and without one the import is refused. */
			model: Opt(ModelRefSchema),
		}),
		Obj({ bot: BotSchema, unmatchedPlugins: Type.Array(Type.String()) }),
	),
	route("listManagedBots", "GET", "/api/bots/:botId/managed", Obj({ botId: Id }), Obj({ bots: Type.Array(BotSchema) })),
	route(
		"setManagedBots",
		"PUT",
		"/api/bots/:botId/managed",
		Obj({ botId: Id, botIds: Type.Array(Id) }),
		Obj({ bots: Type.Array(BotSchema) }),
	),

	// Conversations, files, approvals
	route(
		"getHistory",
		"GET",
		"/api/bots/:botId/history",
		Obj({ botId: Id, before: Opt(Id), limit: Opt(Type.Number()) }),
		ConversationViewSchema,
	),
	route(
		"getGroupHistory",
		"GET",
		"/api/groups/:groupId/history",
		Obj({ groupId: Id, before: Opt(Id), limit: Opt(Type.Number()) }),
		ConversationViewSchema,
	),
	route(
		"reactInGroup",
		"POST",
		"/api/groups/:groupId/entries/:entryId/reactions",
		Obj({ groupId: Id, entryId: Id, emoji: Type.String() }),
		Ok,
	),
	/** The full exchange behind a "Messaged <bot>" or "Message from <bot>" row, read-only. */
	route(
		"getExchange",
		"GET",
		"/api/bots/:botId/exchanges/:entryId",
		Obj({ botId: Id, entryId: Id }),
		Obj({
			peerBotId: Id,
			messages: Type.Array(
				Obj({
					from: Id,
					intent: Type.Union([
						Type.Literal("request"),
						Type.Literal("question"),
						Type.Literal("status"),
						Type.Literal("result"),
					]),
					text: Type.String({ maxLength: 8000 }),
					createdAt: Type.Number(),
				}),
			),
		}),
	),
	/** An action from an MCP App panel; it goes through the same approval policy as the model's actions. */
	route(
		"appAction",
		"POST",
		"/api/bots/:botId/entries/:entryId/app-action",
		Obj({ botId: Id, entryId: Id, action: Type.Unknown() }),
		Obj({ result: Opt(Type.Unknown()), approval: Opt(ApprovalSchema) }),
	),
	route(
		"react",
		"POST",
		"/api/bots/:botId/entries/:entryId/reactions",
		Obj({ botId: Id, entryId: Id, emoji: Type.String() }),
		Ok,
	),
	route("answerSuggestion", "POST", "/api/suggestions/:id", Obj({ id: Id, accept: Type.Boolean() }), Ok),
	route(
		"undoSettingsChange",
		"POST",
		"/api/bots/:botId/entries/:entryId/undo",
		Obj({ botId: Id, entryId: Id }),
		BotSchema,
	),
	route(
		"saveSkillDraft",
		"POST",
		"/api/bots/:botId/entries/:entryId/save-skill",
		Obj({ botId: Id, entryId: Id, ...SkillFields }),
		SkillSchema,
	),
	route(
		"discardSkillDraft",
		"POST",
		"/api/bots/:botId/entries/:entryId/discard-skill",
		Obj({ botId: Id, entryId: Id }),
		Ok,
	),
	/** Answers a secret-request card: a value saves it to the vault (write-only), no value dismisses it. */
	route(
		"answerSecretRequest",
		"POST",
		"/api/bots/:botId/entries/:entryId/secret",
		Obj({ botId: Id, entryId: Id, value: Opt(Type.String({ minLength: 1 })) }),
		Ok,
	),
	route(
		"linkPreview",
		"GET",
		"/api/link-preview",
		Obj({ url: Type.String() }),
		Obj({
			title: Opt(Type.String()),
			description: Opt(Type.String()),
			image: Opt(Type.String()),
			site: Opt(Type.String()),
		}),
	),
	route(
		"uploadFile",
		"POST",
		"/api/files",
		Obj({
			name: Type.String(),
			mime: Type.String(),
			kind: FileKindSchema,
			botId: Opt(Id),
			/** Base64 file content. */ data: Type.String(),
		}),
		FileRefSchema,
	),
	route(
		"listFiles",
		"GET",
		"/api/files",
		Obj({ botId: Opt(Id), kind: Opt(FileKindSchema) }),
		Obj({ files: Type.Array(FileRefSchema) }),
	),
	route("deleteFile", "DELETE", "/api/files/:id", Obj({ id: Id }), Ok),
	/** A short-lived download URL for one of the user's files. */
	route("getFile", "GET", "/api/files/:id", Obj({ id: Id }), Obj({ file: FileRefSchema, url: Type.String() })),
	route(
		"listApprovals",
		"GET",
		"/api/approvals",
		Obj({ botId: Opt(Id) }),
		Obj({ approvals: Type.Array(ApprovalSchema) }),
	),
	route(
		"answerApproval",
		"POST",
		"/api/approvals/:id",
		Obj({
			id: Id,
			decision: Type.Union([Type.Literal("allow"), Type.Literal("always"), Type.Literal("deny")]),
			/** A passkey assertion, for spending approvals. */
			passkey: Opt(Type.Unknown()),
		}),
		Obj({
			result: Type.Union([
				Type.Literal("ok"),
				Type.Literal("used"),
				Type.Literal("changed"),
				Type.Literal("expired"),
				Type.Literal("revoked"),
			]),
			approval: ApprovalSchema,
		}),
	),

	// Memory
	route("listNotes", "GET", "/api/bots/:botId/notes", Obj({ botId: Id }), Obj({ notes: Type.Array(NoteSchema) })),
	route("getNote", "GET", "/api/bots/:botId/notes/:name", Obj({ botId: Id, name: Id }), NoteSchema),
	route("deleteNote", "DELETE", "/api/bots/:botId/notes/:name", Obj({ botId: Id, name: Id }), Ok),
	route(
		"shareNotes",
		"POST",
		"/api/bots/:botId/notes/share",
		Obj({ botId: Id, names: Type.Array(Id) }),
		Obj({ shared: Type.Number(), keptPrivate: Type.Number() }),
	),
	route("getSharedMemory", "GET", "/api/memory", None, Obj({ notes: Type.Array(NoteSchema), summary: Type.String() })),
	route(
		"listOpenWork",
		"GET",
		"/api/bots/:botId/open-work",
		Obj({ botId: Id }),
		Obj({ items: Type.Array(OpenWorkItemSchema) }),
	),
	route(
		"addOpenWork",
		"POST",
		"/api/bots/:botId/open-work",
		Obj({ botId: Id, text: Type.String({ minLength: 1 }) }),
		OpenWorkItemSchema,
	),
	route(
		"updateOpenWork",
		"PATCH",
		"/api/bots/:botId/open-work/:id",
		Obj({ botId: Id, id: Id, text: Opt(Type.String()), done: Opt(Type.Boolean()) }),
		OpenWorkItemSchema,
	),
	route("deleteOpenWork", "DELETE", "/api/bots/:botId/open-work/:id", Obj({ botId: Id, id: Id }), Ok),

	// The computer
	route("getComputer", "GET", "/api/computer", None, ComputerStateSchema),
	route(
		"getScreen",
		"POST",
		"/api/computer/screen",
		Obj({ botId: Id, mode: Type.Union([Type.Literal("view"), Type.Literal("control")]) }),
		Url,
	),
	route("setControl", "POST", "/api/computer/control", Obj({ botId: Id, take: Type.Boolean() }), ComputerStateSchema),
	route(
		"runMaintenance",
		"POST",
		"/api/computer/maintenance",
		Obj({ action: MaintenanceActionSchema }),
		ComputerStateSchema,
	),
	route("getSetupScript", "GET", "/api/computer/setup", None, Obj({ script: Type.String() })),
	route("putSetupScript", "PUT", "/api/computer/setup", Obj({ script: Type.String() }), Obj({ script: Type.String() })),
	route("protectedInput", "POST", "/api/computer/protected-input", Obj({ botId: Id, value: Type.String() }), Ok),
	route(
		"startTeaching",
		"POST",
		"/api/bots/:botId/teach",
		Obj({ botId: Id, goal: Type.String({ minLength: 1 }) }),
		Obj({ sessionId: Id }),
	),
	route(
		"stopTeaching",
		"POST",
		"/api/bots/:botId/teach/:sessionId/stop",
		Obj({ botId: Id, sessionId: Id }),
		SkillDraftSchema,
	),

	// Connectors
	route(
		"listCatalog",
		"GET",
		"/api/catalog",
		Obj({ q: Opt(Type.String()), category: Opt(CatalogCategorySchema) }),
		Obj({ entries: Type.Array(CatalogEntrySchema) }),
	),
	route("getCatalogEntry", "GET", "/api/catalog/:appId", Obj({ appId: Id }), CatalogEntrySchema),
	route(
		"listAppEvents",
		"GET",
		"/api/catalog/:appId/events",
		Obj({ appId: Id }),
		Obj({ events: Type.Array(Obj({ id: Id, name: Type.String(), description: Type.String() })) }),
	),
	route(
		"connectApp",
		"POST",
		"/api/connections/:appId",
		Obj({ appId: Id, skills: Type.Boolean(), apiKey: Opt(Type.String()) }),
		Obj({ entry: CatalogEntrySchema, authorizeUrl: Opt(Type.String()) }),
	),
	route("disconnectApp", "DELETE", "/api/connections/:appId", Obj({ appId: Id }), Ok),
	route(
		"updateConnection",
		"PATCH",
		"/api/connections/:appId",
		Obj({ appId: Id, usageNote: Opt(Type.String({ maxLength: 500 })), permissions: Opt(ConnectorPermissionsSchema) }),
		CatalogEntrySchema,
	),
	route(
		"addCustomServer",
		"POST",
		"/api/connections",
		Obj({ name: Type.String({ minLength: 1 }), url: Type.String() }),
		CatalogEntrySchema,
	),

	// Skills
	route(
		"listSkills",
		"GET",
		"/api/skills",
		Obj({ scope: Opt(SkillScopeSchema), botId: Opt(Id), q: Opt(Type.String()) }),
		Obj({ skills: Type.Array(SkillSchema) }),
	),
	route("createSkill", "POST", "/api/skills", Obj({ ...SkillFields, botId: Opt(Id) }), SkillSchema),
	route(
		"updateSkill",
		"PATCH",
		"/api/skills/:id",
		Obj({ id: Id, ...Type.Partial(Obj(SkillFields)).properties }),
		SkillSchema,
	),
	route("deleteSkill", "DELETE", "/api/skills/:id", Obj({ id: Id }), Ok),
	route("shareSkill", "POST", "/api/skills/:id/share", Obj({ id: Id }), SkillSchema),
	route(
		"previewGitHubSkills",
		"POST",
		"/api/skills/github/preview",
		Obj({ url: Type.String() }),
		Obj({ skills: Type.Array(SkillDraftSchema) }),
	),
	route(
		"addGitHubSkills",
		"POST",
		"/api/skills/github",
		Obj({ url: Type.String(), names: Type.Array(Type.String()) }),
		Obj({ skills: Type.Array(SkillSchema) }),
	),

	// Routines, runs, usage
	route("listRoutines", "GET", "/api/routines", Obj({ botId: Opt(Id) }), Obj({ routines: Type.Array(RoutineSchema) })),
	route("getRoutine", "GET", "/api/routines/:id", Obj({ id: Id }), RoutineSchema),
	route("createRoutine", "POST", "/api/routines", Obj({ botId: Id, ...RoutineFields }), RoutineSchema),
	route(
		"updateRoutine",
		"PATCH",
		"/api/routines/:id",
		Obj({ id: Id, ...Type.Partial(Obj(RoutineFields)).properties }),
		RoutineSchema,
	),
	route("deleteRoutine", "DELETE", "/api/routines/:id", Obj({ id: Id }), Ok),
	route("testRoutine", "POST", "/api/routines/:id/test", Obj({ id: Id }), RunSchema),
	/** The only response that carries the webhook's secret URL. */
	route(
		"mintWebhook",
		"POST",
		"/api/routines/:id/webhook",
		Obj({ id: Id }),
		Obj({ trigger: TriggerSchema, url: Type.String() }),
	),
	route(
		"estimateWatch",
		"POST",
		"/api/routines/estimate",
		Obj({ trigger: TriggerSchema }),
		Obj({ computerHoursPerMonth: Type.Number() }),
	),
	route(
		"listRuns",
		"GET",
		"/api/runs",
		Obj({
			botId: Opt(Id),
			routineId: Opt(Id),
			status: Opt(RunStatusSchema),
			from: Opt(Type.Number()),
			to: Opt(Type.Number()),
		}),
		Obj({ runs: Type.Array(RunSchema) }),
	),
	route("stopRun", "POST", "/api/runs/:id/stop", Obj({ id: Id }), RunSchema),
	route(
		"listUsage",
		"GET",
		"/api/usage",
		Obj({ from: Opt(Type.Number()), to: Opt(Type.Number()) }),
		Obj({ rows: Type.Array(UsageRowSchema) }),
	),

	// Pages
	route(
		"listPages",
		"GET",
		"/api/pages",
		Obj({ q: Opt(Type.String()) }),
		Obj({ pages: Type.Array(PageSummarySchema) }),
	),
	route("getPage", "GET", "/api/pages/:id", Obj({ id: Id }), PageSchema),
	route(
		"updatePage",
		"PATCH",
		"/api/pages/:id",
		Obj({
			id: Id,
			baseVersion: Type.Number(),
			title: Opt(Type.String()),
			pinned: Opt(Type.Boolean()),
			blocks: Opt(Type.Array(PageBlockSchema)),
		}),
		PageSchema,
	),
	route(
		"listPageVersions",
		"GET",
		"/api/pages/:id/versions",
		Obj({ id: Id }),
		Obj({ versions: Type.Array(Obj({ version: Type.Number(), updatedAt: Type.Number(), author: Type.String() })) }),
	),
	route("getPageVersion", "GET", "/api/pages/:id/versions/:version", Obj({ id: Id, version: Id }), PageSchema),
	route(
		"restorePageVersion",
		"POST",
		"/api/pages/:id/versions/:version/restore",
		Obj({ id: Id, version: Id }),
		PageSchema,
	),
	route(
		"pressPageButton",
		"POST",
		"/api/pages/:id/buttons/:blockId",
		Obj({ id: Id, blockId: Id }),
		Obj({ runId: Opt(Id), approval: Opt(ApprovalSchema) }),
	),
	route(
		"exportPage",
		"GET",
		"/api/pages/:id/export",
		Obj({ id: Id, format: Type.Union([Type.Literal("markdown"), Type.Literal("pdf")]) }),
		Obj({ fileId: Id }),
	),

	// Inbox and tasks
	route(
		"listInbox",
		"GET",
		"/api/inbox",
		None,
		Obj({ items: Type.Array(InboxItemSchema), tasks: Type.Array(TaskSchema) }),
	),
	route(
		"updateInboxItem",
		"PATCH",
		"/api/inbox/:id",
		Obj({ id: Id, pinned: Opt(Type.Boolean()), done: Opt(Type.Boolean()), read: Opt(Type.Boolean()) }),
		InboxItemSchema,
	),
	route(
		"createTask",
		"POST",
		"/api/tasks",
		Obj({ title: Type.String({ minLength: 1 }), ownerBotId: Opt(Id), due: Opt(Type.Number()) }),
		TaskSchema,
	),
	route(
		"updateTask",
		"PATCH",
		"/api/tasks/:id",
		Obj({ id: Id, title: Opt(Type.String()), status: Opt(TaskSchema.properties.status), due: Opt(Type.Number()) }),
		TaskSchema,
	),

	// Group chats
	route(
		"createGroup",
		"POST",
		"/api/groups",
		Obj({ name: Type.String({ minLength: 1 }), memberIds: GroupSchema.properties.memberIds, leadId: Id }),
		GroupSchema,
	),
	route("getGroup", "GET", "/api/groups/:groupId", Obj({ groupId: Id }), GroupSchema),
	route(
		"updateGroup",
		"PATCH",
		"/api/groups/:groupId",
		Obj({
			groupId: Id,
			name: Opt(Type.String()),
			memberIds: Opt(GroupSchema.properties.memberIds),
			leadId: Opt(Id),
			turnBudget: Opt(Type.Number()),
			pinned: Opt(Type.Boolean()),
		}),
		GroupSchema,
	),
	route("deleteGroup", "DELETE", "/api/groups/:groupId", Obj({ groupId: Id }), Ok),

	// Settings: approvals, vault, 1Password, payments, finance, routing
	route("getApprovalSettings", "GET", "/api/settings/approvals", None, ApprovalSettingsSchema),
	route(
		"updateApprovalSettings",
		"PATCH",
		"/api/settings/approvals",
		Type.Partial(ApprovalSettingsSchema),
		ApprovalSettingsSchema,
	),
	route("listVault", "GET", "/api/vault", None, Obj({ items: Type.Array(VaultItemSchema) })),
	route(
		"putVault",
		"POST",
		"/api/vault",
		Obj({
			...Type.Omit(VaultItemSchema, ["id", "createdAt"]).properties,
			/** Write-only. */ value: Type.String({ minLength: 1 }),
		}),
		VaultItemSchema,
	),
	route("deleteVault", "DELETE", "/api/vault/:id", Obj({ id: Id }), Ok),
	route("getOnePassword", "GET", "/api/settings/1password", None, OnePasswordSchema),
	route("connectOnePassword", "POST", "/api/settings/1password", None, Url),
	route("disconnectOnePassword", "DELETE", "/api/settings/1password", None, Ok),
	route("getPayments", "GET", "/api/settings/payments", None, PaymentsSchema),
	route("linkWallet", "POST", "/api/settings/payments/link", None, Url),
	route(
		"setSpendLimits",
		"PUT",
		"/api/settings/payments/limits",
		Obj({ limits: Type.Array(SpendLimitSchema) }),
		PaymentsSchema,
	),
	route("getFinance", "GET", "/api/finance", None, FinanceSchema),
	route("linkBank", "POST", "/api/finance/link", None, Obj({ linkToken: Type.String() })),
	route("completeBankLink", "POST", "/api/finance/link/complete", Obj({ publicToken: Type.String() }), FinanceSchema),
	route("unlinkBank", "DELETE", "/api/finance/accounts/:id", Obj({ id: Id }), Ok),
	route("getHomeRouting", "GET", "/api/settings/home-routing", None, HomeRoutingSchema),
	route("updateHomeRouting", "PATCH", "/api/settings/home-routing", Type.Partial(HomeRoutingSchema), HomeRoutingSchema),
	route("getTailscale", "GET", "/api/settings/tailscale", None, TailscaleSchema),
	route(
		"joinTailscale",
		"POST",
		"/api/settings/tailscale",
		Obj({ authKey: Type.String({ minLength: 1 }), exitNode: Opt(Type.String()) }),
		TailscaleSchema,
	),
	route("leaveTailscale", "DELETE", "/api/settings/tailscale", None, TailscaleSchema),

	// Channels
	route("getChannels", "GET", "/api/channels", None, ChannelsSchema),
	route(
		"createTelegramCode",
		"POST",
		"/api/channels/telegram/code",
		Obj({ botId: Id }),
		Obj({ code: Type.String(), expiresAt: Type.Number() }),
	),
	route("slackInstall", "POST", "/api/channels/slack/install", None, Url),
	route("linkSlackDms", "POST", "/api/channels/slack/dms", Obj({ botId: Id }), ChannelLinkSchema),
	route(
		"updateChannelLink",
		"PATCH",
		"/api/channels/links/:id",
		Obj({ id: Id, botId: Opt(Id), mode: Opt(ChannelLinkSchema.properties.mode), rules: Opt(Type.String()) }),
		ChannelLinkSchema,
	),
	route("deleteChannelLink", "DELETE", "/api/channels/links/:id", Obj({ id: Id }), Ok),

	// Billing
	route("getBilling", "GET", "/api/billing", None, BillingSchema),
	route("subscribe", "POST", "/api/billing/subscribe", None, Url),
	route("cancelSubscription", "POST", "/api/billing/cancel", None, BillingSchema),
	/** Dollars, at least 5. */
	route("topUp", "POST", "/api/billing/top-up", Obj({ amount: Type.Number({ minimum: 5 }) }), Url),
	route(
		"setSpendingLimit",
		"PUT",
		"/api/billing/limit",
		Obj({ limit: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]) }),
		BillingSchema,
	),
	route(
		"setAutoTopUp",
		"PUT",
		"/api/billing/auto-top-up",
		Obj({
			enabled: Type.Boolean(),
			threshold: Opt(Type.Number({ minimum: 0 })),
			amount: Opt(Type.Number({ minimum: 5 })),
		}),
		BillingSchema,
	),
] as const;

export type Route = (typeof ROUTES)[number];
export type RouteName = Route["name"];
export type RouteRequest<N extends RouteName> = Static<Extract<Route, { name: N }>["request"]>;
export type RouteResponse<N extends RouteName> = Static<Extract<Route, { name: N }>["response"]>;

/** One method per route, taking its request and resolving to its response. */
export type ApiClient = {
	[R in Route as R["name"]]: (request: Static<R["request"]>) => Promise<Static<R["response"]>>;
};

/** A non-2xx reply; `code` is the JSON body's `error` field. */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message?: string) {
		super(message ?? `${status} ${code}`);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
}

/** Builds the typed client over any fetch (the browser's, the desktop's ticketed one, or the fake backend's). */
export function createApiClient(fetch: typeof globalThis.fetch, base: string): ApiClient {
	const client: Record<string, (request: Record<string, unknown>) => Promise<unknown>> = {};
	for (const route of ROUTES) client[route.name] = (request) => call(fetch, base, route, request);
	return client as unknown as ApiClient;
}

async function call(
	fetch: typeof globalThis.fetch,
	base: string,
	route: RouteDef,
	request: Record<string, unknown>,
): Promise<unknown> {
	const rest: Record<string, unknown> = { ...request };
	const path = route.path.replace(/:(\w+)/g, (_, name: string) => {
		const value = rest[name];
		delete rest[name];
		return encodeURIComponent(String(value));
	});
	const url = new URL(path, base);
	const hasBody = route.method !== "GET" && route.method !== "DELETE";
	if (!hasBody)
		for (const [key, value] of Object.entries(rest))
			if (value !== undefined) url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
	const response = await fetch(url.toString(), {
		method: route.method,
		headers: hasBody ? { "content-type": "application/json" } : undefined,
		body: hasBody ? JSON.stringify(rest) : undefined,
	});
	const body: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const error = isRecord(body) ? body : {};
		throw new ApiError(
			response.status,
			typeof error.error === "string" ? error.error : "http_error",
			typeof error.message === "string" ? error.message : undefined,
		);
	}
	return body;
}

/** Finds the route for a request, with its path params. Query and body values are the caller's to parse. */
export function matchRoute(
	method: string,
	pathname: string,
): { route: Route; params: Record<string, string> } | undefined {
	const parts = pathname.split("/");
	for (const route of ROUTES) {
		if (route.method !== method) continue;
		const params = matchPath(route.path.split("/"), parts);
		if (params) return { route, params };
	}
	return undefined;
}

function matchPath(pattern: string[], parts: string[]): Record<string, string> | undefined {
	if (pattern.length !== parts.length) return undefined;
	const params: Record<string, string> = {};
	for (const [i, segment] of pattern.entries()) {
		const part = parts[i]!;
		if (!segment.startsWith(":")) {
			if (segment !== part) return undefined;
		} else if (part === "") return undefined;
		else params[segment.slice(1)] = decodeURIComponent(part);
	}
	return params;
}

/**
 * Reads a GET or DELETE query into the route's request shape. A value the field's schema accepts as a string
 * stays a string (so an id of "12" stays "12"); otherwise it is the JSON the client encoded. Validation of the
 * whole request is the caller's, with `parse`.
 */
export function queryToRequest(route: Route, search: URLSearchParams): Record<string, unknown> {
	const properties: Record<string, TSchema | undefined> = route.request.properties;
	const request: Record<string, unknown> = {};
	for (const [key, value] of search) {
		const schema = properties[key];
		request[key] = schema && Value.Check(schema, value) ? value : decodeJson(value);
	}
	return request;
}

function decodeJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
