// The fake backend's starting world: the bots, threads and records every UI screen is built against.
import type {
	Account,
	Approval,
	ApprovalSettings,
	Billing,
	Bot,
	CatalogEntry,
	CatchUp,
	Channels,
	ComputerState,
	ConversationView,
	Entry,
	FileRef,
	Finance,
	Group,
	HomeRouting,
	InboxItem,
	InstructionsVersion,
	ModelOption,
	Note,
	Onboarding,
	OnePassword,
	OpenWorkItem,
	Page,
	Passkey,
	Payments,
	ProviderConnection,
	Routine,
	Run,
	Section,
	SignInMethod,
	Skill,
	Tailscale,
	Task,
	Template,
	UsageRow,
	VaultItem,
} from "../entities.ts";
import { FAKE_EPOCH } from "./stream.ts";

/** Everything the fake serves. Plain JSON, so a seed can also be loaded from a file. */
export interface FakeSeed {
	account: Account;
	signIn: { methods: SignInMethod[]; passkeys: Passkey[] };
	providers: ProviderConnection[];
	models: ModelOption[];
	bots: Bot[];
	groups: Group[];
	sections: Section[];
	/** Keyed `bot:<id>` or `group:<id>`. */
	threads: Record<string, ConversationView>;
	/** What each bot streams when messaged; others get a generic reply. */
	replies: Record<string, string>;
	instructionVersions: Record<string, InstructionsVersion[]>;
	managed: Record<string, string[]>;
	notes: Record<string, Note[]>;
	/** Development seeding only: messages already in a bot's own conversation, for long-chat tests. */
	history?: Record<string, { role: "user" | "assistant"; text: string; at: number }[]>;
	sharedMemory: { notes: Note[]; summary: string };
	openWork: Record<string, OpenWorkItem[]>;
	files: FileRef[];
	approvals: Approval[];
	approvalSettings: ApprovalSettings;
	routines: Routine[];
	runs: Run[];
	usage: UsageRow[];
	catalog: CatalogEntry[];
	skills: Skill[];
	templates: Template[];
	pages: Page[];
	inbox: InboxItem[];
	tasks: Task[];
	catchUp: CatchUp | null;
	onboarding: Onboarding;
	computer: ComputerState;
	setupScript: string;
	vault: VaultItem[];
	onePassword: OnePassword;
	payments: Payments;
	finance: Finance;
	homeRouting: HomeRouting;
	tailscale: Tailscale;
	channels: Channels;
	billing: Billing;
}

const minutes = (n: number) => FAKE_EPOCH - n * 60_000;
const hours = (n: number) => minutes(n * 60);
const days = (n: number) => hours(n * 24);

/** Model ids used by fixtures. They are deliberately not in any provider's catalog. */
const FAKE_MODEL = { provider: "fake", modelId: "fake-model", thinking: "medium" };

function bot(fields: Pick<Bot, "id" | "name" | "purpose" | "instructions" | "avatar"> & Partial<Bot>): Bot {
	return {
		instructionsVersion: 1,
		model: FAKE_MODEL,
		approvals: "default",
		computerAccess: true,
		notify: "input",
		suggestions: false,
		showTools: false,
		appIds: [],
		status: "idle",
		pinned: false,
		archived: false,
		unread: 0,
		needsYou: false,
		email: `${fields.id}.raghav@bots.knightcode.dev`,
		lastActivityAt: minutes(30),
		createdAt: days(12),
		...fields,
	};
}

function message(
	id: string,
	role: "user" | "assistant",
	text: string,
	at: number,
	extra: Partial<Extract<Entry, { kind: "message" }>> = {},
): Entry {
	return { kind: "message", id, role, text, createdAt: at, ...extra };
}

const permissions = { reads: "auto", writes: "approval", tools: {} } as const;

function app(
	id: string,
	name: string,
	maker: string,
	category: CatalogEntry["category"],
	description: string,
	extra: Partial<CatalogEntry> = {},
): CatalogEntry {
	return {
		id,
		name,
		maker,
		category,
		icon: id,
		description,
		auth: "oauth",
		skills: [],
		permissions: { ...permissions, tools: {} },
		...extra,
	};
}

/** The default world: four bots, a group chat, and records of every kind. */
export function defaultSeed(): FakeSeed {
	const inboxApproval: Approval = {
		id: "appr-dana",
		botId: "inbox",
		digest: "sha256:6f1c0a1d3e",
		action: { tool: "send_email", title: "Send the reply to Dana Park", target: "dana@example.com" },
		expiresAt: FAKE_EPOCH + 24 * 3_600_000,
		state: "pending",
	};
	const bots: Bot[] = [
		bot({
			id: "reviewer",
			name: "Reviewer",
			purpose: "Reviews pull requests and flags risky changes",
			instructions:
				"Review every new pull request in knightcode/app. Comment on bugs, missing tests and risky migrations. Approve only small, safe changes.",
			avatar: { shape: "hex", color: "blue" },
			appIds: ["github", "linear"],
			main: true,
			pinned: true,
			unread: 2,
			status: "working",
			lastActivityAt: minutes(3),
		}),
		bot({
			id: "inbox",
			name: "Inbox",
			purpose: "Triages email and drafts replies for approval",
			instructions:
				"Read new mail every morning. Archive newsletters, label invoices, and draft replies to customers. Never send without approval.",
			avatar: { shape: "cloud", color: "orange" },
			appIds: ["gmail", "google-calendar"],
			needsYou: true,
			unread: 1,
			approvals: "ask",
			lastActivityAt: minutes(8),
		}),
		bot({
			id: "social",
			name: "Social",
			purpose: "Plans, writes and schedules social posts",
			instructions:
				"Keep a two-week posting calendar. Draft posts in our voice and schedule them through Buffer after I approve the week.",
			avatar: { shape: "flower", color: "magenta" },
			appIds: ["buffer", "notion"],
			status: "sleeping",
			lastActivityAt: hours(5),
		}),
		bot({
			id: "chief",
			name: "Chief of Staff",
			purpose: "Coordinates your other bots and writes the daily briefing",
			instructions:
				"Each weekday at 8am, tell me what every bot did, what waits on me and what is still open. Hand work to the right bot.",
			avatar: { shape: "shield", color: "green" },
			appIds: ["slack", "notion"],
			email: "chief-of-staff.raghav@bots.knightcode.dev",
			suggestions: true,
			lastActivityAt: hours(1),
		}),
	];
	const reviewerThread: Entry[] = [
		message("r1", "user", "Review PR 11 when it lands, and keep an eye on the migration.", hours(3)),
		message(
			"r2",
			"assistant",
			"PR 11 is in. Two things need a look before it merges:\n\n| File | Issue |\n| --- | --- |\n| `db/0007_accounts.sql` | Drops a column that `billing.ts` still reads |\n| `api/sessions.ts` | No test for the expired-session path |\n\nI left both as review comments.",
			hours(2.9),
		),
		{
			kind: "bot-message",
			id: "r3",
			direction: "from",
			peerBotId: "chief",
			intent: "request",
			text: "Can you summarise today's open PRs for the briefing?",
			createdAt: hours(1),
		},
		message("r4", "assistant", "Sent Chief of Staff a summary: three open PRs, one blocked on CI.", minutes(58)),
	];
	const inboxThread: Entry[] = [
		message("i1", "user", "Draft a reply to Dana about the renewal, keep it short.", minutes(20)),
		message(
			"i2",
			"assistant",
			"Here is a draft. I'll send it once you allow it.\n\n> Hi Dana, thanks for the reminder. We'll renew on the same plan this month.",
			minutes(9),
		),
		{ kind: "card", id: "i3", createdAt: minutes(8), card: { type: "approval", approval: inboxApproval } },
		{
			kind: "card",
			id: "i4",
			createdAt: minutes(7),
			card: {
				type: "question",
				question: "Which label should invoices get?",
				choices: ["Finance", "Receipts", "Leave unlabeled"],
				allowOther: true,
			},
		},
	];
	const socialThread: Entry[] = [
		message(
			"s1",
			"assistant",
			"LinkedIn signed me out. Can you sign in on my screen so I can schedule Thursday's post?",
			hours(5),
		),
		{
			kind: "card",
			id: "s2",
			createdAt: hours(5),
			card: { type: "takeover", reason: "Sign in to LinkedIn", state: "requested" },
		},
	];
	const chiefThread: Entry[] = [
		message(
			"c1",
			"assistant",
			"Morning briefing is ready: Reviewer cleared two PRs, Inbox has one reply waiting for you, Social needs a sign-in.",
			hours(1.2),
		),
		{
			kind: "bot-message",
			id: "c2",
			direction: "to",
			peerBotId: "reviewer",
			intent: "request",
			text: "Can you summarise today's open PRs for the briefing?",
			createdAt: hours(1),
		},
		{
			kind: "card",
			id: "c3",
			createdAt: minutes(50),
			card: {
				type: "suggestion",
				suggestionId: "sug-invoices",
				text: "Three invoices are overdue. Want me to ask Inbox to chase them?",
				state: "open",
			},
		},
	];
	const groupThread: Entry[] = [
		message("g1", "user", "@everyone launch is Thursday. What's left?", hours(2)),
		message("g2", "assistant", "Two PRs still open; both should merge tomorrow.", hours(1.9), { botId: "reviewer" }),
		{ kind: "turn", id: "g3", botId: "social", outcome: "pass", createdAt: hours(1.9) },
		message(
			"g4",
			"assistant",
			"I'll put the launch checklist on the Roadmap page and remind everyone Wednesday.",
			hours(1.8),
			{ botId: "chief" },
		),
	];
	const view = (entries: Entry[]): ConversationView => ({ entries, running: false, hasEarlier: false });
	const note = (
		name: string,
		description: string,
		body: string,
		ageDays: number,
		type: Note["type"] = "fact",
	): Note => ({
		name,
		description,
		type,
		body,
		updatedAt: days(ageDays),
		shared: false,
		outside: false,
	});
	const inboxItem = (
		id: string,
		kind: InboxItem["kind"],
		botId: string,
		title: string,
		at: number,
		extra: Partial<InboxItem> = {},
	): InboxItem => ({
		id,
		kind,
		botId,
		title,
		createdAt: at,
		pinned: false,
		done: false,
		read: false,
		...extra,
	});
	const inbox: InboxItem[] = [
		inboxItem("in-approval", "approval", "inbox", "Send the reply to Dana Park", minutes(8), {
			entryId: "i3",
			approvalId: inboxApproval.id,
		}),
		inboxItem("in-question", "question", "inbox", "Which label should invoices get?", minutes(7), { entryId: "i4" }),
		inboxItem("in-takeover", "takeover", "social", "Sign in to LinkedIn", hours(5), { entryId: "s2" }),
		inboxItem("in-review", "review", "reviewer", "PR 11 review is ready", hours(2.9), { entryId: "r2", read: true }),
		inboxItem("in-failure", "failure", "social", "Thursday's post failed to schedule", hours(4), {
			detail: "Buffer returned 401",
		}),
		inboxItem("in-task", "task", "chief", "Confirm the launch date with design", hours(6)),
		inboxItem("in-suggestion", "suggestion", "chief", "Chase three overdue invoices", minutes(50), { entryId: "c3" }),
	];
	const schedule = (cron: string) => ({ kind: "schedule" as const, cron, timeZone: "Asia/Kolkata" });
	const grant = (actions: string[], targets: string[], perDay?: number) => ({
		actions,
		targets,
		limits: perDay === undefined ? {} : { perDay },
	});
	const routines: Routine[] = [
		{
			id: "rt-pr",
			botId: "reviewer",
			name: "Review new pull requests",
			prompt: "Review the pull request in the event. Comment on bugs and missing tests.",
			triggers: [
				{ kind: "github", repo: "knightcode/app", events: ["pull_request.opened", "pull_request.synchronize"] },
			],
			grant: grant(["github.comment"], ["knightcode/app"], 20),
			active: true,
			lastRunAt: hours(2.9),
		},
		{
			id: "rt-ci",
			botId: "reviewer",
			name: "Nightly CI digest",
			prompt: "Summarise last night's CI failures and who owns each.",
			triggers: [schedule("0 7 * * 1-5")],
			grant: grant([], []),
			active: true,
			nextRunAt: FAKE_EPOCH + 15 * 3_600_000,
		},
		{
			id: "rt-mail",
			botId: "inbox",
			name: "Answer new mail",
			prompt: "Triage the email in the event and draft a reply if it needs one.",
			triggers: [{ kind: "email", from: "*@example.com" }],
			grant: grant(["gmail.draft"], ["raghav@example.com"]),
			active: true,
		},
		{
			id: "rt-gmail",
			botId: "inbox",
			name: "Label invoices",
			prompt: "Label invoices in the new Gmail message.",
			triggers: [{ kind: "composio", appId: "gmail", event: "new_message" }],
			grant: grant(["gmail.label"], ["raghav@example.com"]),
			active: false,
		},
		{
			id: "rt-pricing",
			botId: "inbox",
			name: "Watch the pricing page",
			prompt: "Tell me what changed on the competitor's pricing page.",
			triggers: [
				{
					kind: "watch",
					target: "command",
					source: "curl -s https://example.com/pricing",
					everyMinutes: 60,
					postNoChanges: false,
				},
			],
			grant: grant([], []),
			active: true,
		},
		{
			id: "rt-keyword",
			botId: "social",
			name: "Draft a post on #launch",
			prompt: "Draft a post about the Slack message in the event.",
			triggers: [{ kind: "slack", channel: "#launch", match: "keyword", keyword: "ship it" }],
			grant: grant(["buffer.draft"], ["@knightcode"]),
			active: true,
		},
		{
			id: "rt-incident",
			botId: "chief",
			name: "Incident summary",
			prompt: "Summarise the incident in the webhook payload and tell the right bot.",
			triggers: [{ kind: "webhook", id: "wh-incident" }],
			grant: grant(["slack.post"], ["#incidents"], 10),
			active: true,
		},
		{
			id: "rt-briefing",
			botId: "chief",
			name: "Daily briefing",
			prompt: "Write the daily briefing: what every bot did, what waits on me, what is open.",
			triggers: [schedule("0 8 * * 1-5")],
			grant: grant(["slack.post"], ["@raghav"]),
			active: true,
			lastRunAt: hours(8),
			nextRunAt: FAKE_EPOCH + 16 * 3_600_000,
		},
	];
	const run = (
		id: string,
		botId: string,
		title: string,
		status: Run["status"],
		startedAt: number,
		extra: Partial<Run> = {},
	): Run => ({
		id,
		botId,
		title,
		startedBy: "routine",
		status,
		startedAt,
		...extra,
	});
	return {
		account: {
			id: "acct-raghav",
			workspaceId: "ws-raghav",
			name: "Raghav",
			email: "raghav@example.com",
			handle: "raghav",
			timeZone: "Asia/Kolkata",
			plan: "trial",
			defaultModel: FAKE_MODEL,
			helperModels: {},
			createdAt: days(2),
		},
		signIn: {
			methods: [
				{ kind: "github", label: "GitHub (raghav)" },
				{ kind: "email", label: "raghav@example.com" },
			],
			passkeys: [{ id: "pk-laptop", name: "Windows Hello on this laptop", createdAt: days(2), lastUsedAt: hours(3) }],
		},
		providers: [
			{ provider: "fake", name: "Fake Provider", kind: "api_key", status: "connected" },
			{
				provider: "fake-oauth",
				name: "Fake Subscription",
				kind: "oauth",
				status: "reconnect",
				note: "Sign in again to keep using it from your bots.",
			},
		],
		models: [
			{
				provider: "fake",
				modelId: "fake-model",
				name: "Fake Model",
				thinking: ["low", "medium", "high"],
				images: true,
			},
			{ provider: "fake", modelId: "fake-fast", name: "Fake Fast", thinking: [], images: false },
		],
		bots,
		groups: [
			{
				id: "launch",
				name: "Launch",
				memberIds: ["reviewer", "social", "chief"],
				leadId: "chief",
				turnBudget: 12,
				pinned: false,
				unread: 0,
				needsYou: false,
				createdAt: days(3),
			},
		],
		sections: [{ id: "sec-work", name: "Work", itemIds: ["reviewer", "inbox"] }],
		threads: {
			"bot:reviewer": view(reviewerThread),
			"bot:inbox": view(inboxThread),
			"bot:social": view(socialThread),
			"bot:chief": view(chiefThread),
			"group:launch": view(groupThread),
		},
		replies: {
			reviewer:
				"On it. I'll pull the branch, run the tests, and leave comments on anything risky. I'll post a summary here when the review is done, with the files that need a second look and the tests I added.",
			inbox: "Got it. I'll keep drafting and wait for your approval before anything is sent.",
		},
		instructionVersions: {
			reviewer: [{ version: 1, text: bots[0]!.instructions, createdAt: days(12), author: { kind: "user" } }],
			inbox: [{ version: 1, text: bots[1]!.instructions, createdAt: days(12), author: { kind: "user" } }],
			social: [{ version: 1, text: bots[2]!.instructions, createdAt: days(12), author: { kind: "user" } }],
			chief: [{ version: 1, text: bots[3]!.instructions, createdAt: days(12), author: { kind: "user" } }],
		},
		managed: { chief: ["reviewer", "inbox", "social"] },
		notes: {
			reviewer: [
				note(
					"migrations",
					"migrations need a rollback plan",
					"Raghav wants every migration PR to include a rollback plan.",
					47,
					"preference",
				),
				note("ci-owner", "who owns flaky CI", "Priya owns the flaky e2e job.", 3),
			],
			inbox: [note("dana", "Dana Park is the renewal contact", "Dana Park handles renewals at Acme.", 9)],
			social: [note("voice", "brand voice", "Short sentences, no hashtags, one link per post.", 20, "preference")],
			chief: [
				note(
					"briefing-time",
					"briefing at 8am IST",
					"Send the briefing at 8am India time on weekdays.",
					1,
					"preference",
				),
			],
		},
		sharedMemory: {
			notes: [{ ...note("name", "the user's name", "The user is Raghav.", 12), shared: true }],
			summary: "Raghav runs KnightCode. He prefers short, direct writing and wants approvals before anything is sent.",
		},
		openWork: {
			reviewer: [{ id: "ow-1", text: "Re-review PR 11 after the migration fix", done: false, createdAt: hours(2.8) }],
			inbox: [],
			social: [{ id: "ow-2", text: "Schedule Thursday's launch post", done: false, createdAt: hours(5) }],
			chief: [],
		},
		files: [
			{
				id: "f-brand",
				name: "brand-guide.pdf",
				size: 482_133,
				mime: "application/pdf",
				kind: "knowledge",
				botId: "social",
				createdAt: days(10),
			},
			{
				id: "f-report",
				name: "pr-11-review.md",
				size: 2_048,
				mime: "text/markdown",
				kind: "bot-output",
				botId: "reviewer",
				createdAt: hours(2.9),
			},
		],
		approvals: [inboxApproval],
		approvalSettings: {
			mode: "auto",
			allow: [{ id: "rule-gh", kind: "tool", value: "github.comment" }],
			block: [{ id: "rule-bank", kind: "site", value: "https://bank.example.com" }],
			reviewer: FAKE_MODEL,
		},
		routines,
		runs: [
			run("run-1", "reviewer", "Review new pull requests", "succeeded", hours(2.95), {
				routineId: "rt-pr",
				endedAt: hours(2.9),
				summary: "Two comments on PR 11",
			}),
			run("run-2", "chief", "Daily briefing", "succeeded", hours(8), {
				routineId: "rt-briefing",
				endedAt: hours(7.95),
			}),
			run("run-3", "social", "Draft a post on #launch", "failed", hours(4), {
				routineId: "rt-keyword",
				endedAt: hours(4),
				summary: "Buffer returned 401",
			}),
			run("run-4", "inbox", "Draft a reply to Dana", "running", minutes(9), { startedBy: "user" }),
			run("run-5", "reviewer", "Nightly CI digest", "succeeded", days(1), {
				routineId: "rt-ci",
				endedAt: days(1),
				late: true,
			}),
		],
		usage: [
			{
				botId: "reviewer",
				routineId: "rt-pr",
				model: FAKE_MODEL,
				runs: 14,
				inputTokens: 412_000,
				outputTokens: 38_400,
				costUsd: 3.12,
				day: "2026-11-01",
			},
			{
				botId: "inbox",
				model: FAKE_MODEL,
				runs: 9,
				inputTokens: 120_500,
				outputTokens: 14_200,
				costUsd: 0.88,
				day: "2026-11-01",
			},
			{
				botId: "chief",
				routineId: "rt-briefing",
				model: FAKE_MODEL,
				runs: 5,
				inputTokens: 66_000,
				outputTokens: 9_100,
				costUsd: 0.47,
				day: "2026-10-31",
			},
			{
				botId: "social",
				model: { provider: "fake", modelId: "fake-fast" },
				runs: 3,
				inputTokens: 18_000,
				outputTokens: 4_000,
				costUsd: 0.06,
				day: "2026-10-31",
			},
		],
		catalog: [
			app("github", "GitHub", "GitHub", "developer", "Pull requests, issues and repositories", {
				connection: { status: "connected", connectedAt: days(12) },
				skills: [{ name: "pr-review", description: "Review a pull request" }],
			}),
			app("linear", "Linear", "Linear", "developer", "Issues, projects and cycles", {
				connection: { status: "connected", connectedAt: days(11) },
			}),
			app("sentry", "Sentry", "Sentry", "developer", "Errors and performance issues"),
			app("notion", "Notion", "Notion", "productivity", "Pages, databases and comments", {
				connection: { status: "connected", connectedAt: days(10) },
			}),
			app("slack", "Slack", "Slack", "productivity", "Channels, messages and files", {
				connection: { status: "connected", connectedAt: days(9) },
			}),
			app("gmail", "Gmail", "Google", "google-workspace", "Read, label and draft email", {
				skills: [
					{ name: "gmail-triage", description: "Sort a Gmail inbox into labels" },
					{ name: "gmail-drafts", description: "Draft replies that wait for approval" },
				],
				usageNote: "Always draft, never send.",
				notice: "Gmail connects through Composio, which holds its tokens and passes calls through.",
			}),
			app("google-calendar", "Google Calendar", "Google", "google-workspace", "Events and availability", {
				connection: { status: "connected", connectedAt: days(8) },
			}),
			app("google-drive", "Google Drive", "Google", "google-workspace", "Files you choose to share"),
			app("outlook", "Outlook", "Microsoft", "microsoft-365", "Mail and calendar"),
			app("teams", "Teams", "Microsoft", "microsoft-365", "Chats and channels"),
			app("hubspot", "HubSpot", "HubSpot", "crm-sales", "Contacts, deals and notes"),
			app("salesforce", "Salesforce", "Salesforce", "crm-sales", "Accounts, leads and opportunities"),
			app("buffer", "Buffer", "Buffer", "marketing-social", "Schedule posts to social networks", {
				connection: { status: "reconnect", connectedAt: days(7) },
			}),
			app("mailchimp", "Mailchimp", "Intuit", "marketing-social", "Audiences and campaigns"),
			app("search-console", "Search Console", "Google", "seo", "Search performance for your sites"),
			app("semrush", "Semrush", "Semrush", "seo", "Keywords, rankings and site audits", { auth: "api_key" }),
			app("zendesk", "Zendesk", "Zendesk", "support", "Tickets and help center"),
			app("intercom", "Intercom", "Intercom", "support", "Conversations and contacts"),
			app("workday", "Workday", "Workday", "hr", "Workers, time off and recruiting"),
			app("bamboohr", "BambooHR", "BambooHR", "hr", "Employees and time off", { auth: "api_key" }),
			app("quickbooks", "QuickBooks", "Intuit", "finance", "Invoices, bills and reports"),
			app("stripe", "Stripe", "Stripe", "finance", "Payments, customers and invoices", { auth: "api_key" }),
			app("bigquery", "BigQuery", "Google", "data", "Query your warehouse"),
			app("airtable", "Airtable", "Airtable", "data", "Bases, tables and records"),
		],
		skills: [
			{
				id: "sk-triage",
				name: "inbox-triage",
				description: "Sort a morning inbox into reply, read and archive",
				content: "1. Read unread mail.\n2. Archive newsletters.\n3. Draft replies to customers.",
				scope: "user",
				updatedAt: days(4),
			},
			{
				id: "sk-pr",
				name: "pr-review-checklist",
				description: "Review a pull request against the team checklist",
				content: "Check tests, migrations, error handling and docs.",
				scope: "bot",
				botId: "reviewer",
				updatedAt: days(2),
			},
			{
				id: "sk-gmail",
				name: "gmail-drafts",
				description: "Draft replies that wait for approval",
				content: "Draft in Gmail; never send.",
				scope: "app",
				appId: "gmail",
				updatedAt: days(6),
			},
			{
				id: "sk-seo",
				name: "seo-audit",
				description: "Audit a page for title, headings and links",
				content: "Check the title, meta description, headings and broken links.",
				scope: "catalog",
				updatedAt: days(30),
			},
		],
		templates: [],
		pages: [
			{
				id: "weekly",
				title: "Weekly report",
				ownerBotId: "chief",
				pinned: true,
				updatedAt: hours(1),
				version: 4,
				blocks: [
					{
						type: "text",
						id: "w1",
						text: "## This week\nReviewer cleared **9** pull requests. Inbox answered 31 emails.",
					},
					{
						type: "chart",
						id: "w2",
						spec: {
							kind: "bar",
							title: "Pull requests reviewed",
							labels: ["Mon", "Tue", "Wed", "Thu", "Fri"],
							series: [{ name: "Reviewed", values: [2, 1, 3, 2, 1] }],
						},
					},
					{
						type: "table",
						id: "w3",
						columns: ["Bot", "Runs", "Failures"],
						rows: [
							["Reviewer", 14, 0],
							["Inbox", 9, 0],
							["Social", 3, 1],
						],
					},
					{
						type: "widget",
						id: "w4",
						title: "Open PRs",
						source: { kind: "connector", ref: "github.list_pull_requests" },
						view: "number",
						data: 3,
						refreshedAt: minutes(5),
					},
					{
						type: "button",
						id: "w5",
						label: "Post to #team",
						action: { kind: "connector", appId: "slack", tool: "post_message", args: { channel: "#team" } },
					},
				],
			},
			{
				id: "roadmap",
				title: "Roadmap",
				ownerBotId: "reviewer",
				pinned: false,
				updatedAt: days(1),
				version: 2,
				blocks: [
					{ type: "text", id: "m1", text: "Launch checklist for Thursday." },
					{
						type: "table",
						id: "m2",
						columns: ["Item", "Owner", "Status"],
						rows: [
							["Merge PR 11", "Reviewer", "Open"],
							["Launch post", "Social", "Draft"],
						],
					},
				],
			},
		],
		inbox,
		tasks: [
			{
				id: "task-1",
				title: "Confirm the launch date with design",
				ownerBotId: "chief",
				status: "open",
				due: FAKE_EPOCH + 2 * 86_400_000,
				source: "bot",
				createdAt: hours(6),
			},
			{ id: "task-2", title: "Renew the domain", status: "open", source: "user", createdAt: days(1) },
		],
		catchUp: {
			since: hours(5),
			summary:
				"Reviewer finished two reviews, Inbox has a reply waiting for your approval, and Social's scheduled post failed.",
			finished: [inbox[3]!],
			waiting: [inbox[0]!, inbox[1]!],
			failed: [inbox[4]!],
		},
		onboarding: {
			items: [
				{ id: "providers", done: false },
				{ id: "bot", done: false },
				{ id: "app", done: false },
				{ id: "approvals", done: false },
				{ id: "chat-app", done: false },
			],
		},
		computer: {
			status: "awake",
			lastSavedAt: minutes(12),
			generation: 41,
			screens: [{ botId: "reviewer", controller: "bot" }],
			hoursUsed: 1.5,
			hoursIncluded: 6,
		},
		setupScript: "apt-get install -y ripgrep jq\n",
		vault: [
			{
				id: "v-search",
				kind: "api",
				name: "Search API key",
				origin: "https://api.search.example",
				injection: "bearer",
				createdAt: days(5),
			},
			{ id: "v-crm", kind: "login", name: "CRM login", origin: "https://crm.example.com", createdAt: days(4) },
			{ id: "v-npm", kind: "env", name: "NPM_TOKEN", createdAt: days(3) },
		],
		onePassword: { connected: false },
		payments: { available: true, linked: false, limits: [{ botId: "inbox", perPurchase: 50, perMonth: 200 }] },
		finance: {
			available: true,
			accounts: [
				{
					id: "acc-checking",
					name: "Everyday Checking",
					type: "bank",
					mask: "4821",
					balance: 4210.55,
					currency: "USD",
				},
			],
		},
		homeRouting: { enabled: false, route: "desktop", failClosed: true, allowedPrivateHosts: [] },
		tailscale: { joined: false, hasKey: false },
		channels: {
			links: [
				{
					id: "ch-tg",
					channel: "telegram",
					botId: "chief",
					externalId: "tg:5521",
					label: "@raghav on Telegram",
					createdAt: days(2),
				},
			],
			slackInstalled: true,
			addresses: bots.map((b) => ({ botId: b.id, address: b.email ?? "" })),
		},
		billing: {
			plan: "trial",
			trialEndsAt: FAKE_EPOCH + 86_400_000,
			computerHours: { used: 1.5, included: 6 },
			storage: { usedBytes: 1_288_490_188, includedBytes: 10 * 1024 ** 3 },
			credits: 12.96,
			spendingLimit: 20,
			autoTopUp: { enabled: false },
			receipts: [{ id: "rc-1", at: days(1), amount: 15, fee: 0.74, credited: 12.96 }],
		},
	};
}

/** A seed from a partial one (a JSON file, say): the fields it leaves out come from the default seed. */
export function seedFrom(fields: Partial<FakeSeed>): FakeSeed {
	return { ...defaultSeed(), ...fields };
}
