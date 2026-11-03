// The user object (spec sections 4, 8, 16 and 21): one per account, named by the account id. It holds the vault, the
// model provider credentials, the balance and the file index, all sealed with the account's own data key (itself
// wrapped by the key-encryption key), so destroying that key makes the account's data unreadable at once.
import { refreshPage } from "../pages/widgets.ts";
import { devVaultOrigins } from "../vault/tools.ts";
import type { Credential, CredentialInfo, CredentialStore } from "@knightcode/ai";
import { builtinModels } from "@knightcode/ai/providers/all";
import type { FileKind, FileRef, Skill, SkillScope, VaultItem } from "@knightcode/bots-protocol";
import { DurableObject } from "cloudflare:workers";
import { type ArchiveManifest, openArchive, sealArchive } from "../crypto/archive.ts";
import { createDataKey, unwrapDataKey } from "../crypto/envelope.ts";
import { type Env, getKek } from "../env.ts";
import * as balance from "./balance.ts";
import type { Balance, MeteredKind, Reservation } from "./balance.ts";
import { createCredentialsTable, SealedCredentialStore } from "./credentials.ts";
import { beginEnrollment, createEnrollmentTable, spendEnrollment } from "./enrollment.ts";
import { BANK_FEE_PERIOD_MS, BANK_GRACE_MS, type BankAccount, linkBank, PlaidClient } from "../finance/plaid.ts";
import { isDeleted } from "../account/deletion.ts";
import { withDevModels } from "../dev/model.ts";
import type {
	Account,
	ApprovalSettings,
	Billing,
	CatalogEntry,
	ChannelLink as ProtocolChannelLink,
	Channels,
	FakeSeed,
	Finance,
	HomeRouting,
	InboxItem,
	ModelOption,
	Note,
	Onboarding,
	Page,
	Payments,
	ProviderConnection,
	Section,
	ServerEvent,
	SpendLimit,
	Tailscale,
	Task,
	UsageRow,
} from "@knightcode/bots-protocol";
import { appOrigin } from "../auth/oauth.ts";
import { type CatalogSource, curatedEntries, mergeCatalog, sourceOf } from "../connectors/catalog.ts";
import { ComposioClient } from "../connectors/composio.ts";
import { issueLinkCode } from "../channels/linking.ts";
import { paymentsAvailable, StripeLinkProvider } from "../payments/link.ts";
import { financeAvailable } from "../finance/plaid.ts";
import { AWAY_MS } from "../inbox/catch-up.ts";

const ONBOARDING = ["providers", "bot", "app", "approvals", "chat-app"] as const;
import { AccountState, type BotFlags, type GroupFlags } from "./account-state.ts";
import { createDocsTable, readDoc, updateDoc, writeDoc } from "./docs.ts";
import { ThreadHub } from "./hub.ts";
import { DesktopLink, type ExecResult } from "../desktop/link.ts";
import { type Feature, planAllows, type PlanStatus } from "../billing/plans.ts";
import { createUsageTable, recordUsage, type UsageDelta, usageSummary } from "../billing/usage.ts";
import type { BillingChange } from "../billing/webhooks.ts";
import { Inbox } from "../inbox/inbox.ts";
import {
	addSubscription,
	createPushTables,
	hold,
	isActive,
	markPresence,
	type Notice,
	previewsAllowed,
	pushFor,
	removeSubscription,
	setPreviewsAllowed,
	subscriptions,
	takeHeld,
} from "../push/presence.ts";
import { type PushSubscription, sendPush } from "../push/web-push.ts";
import type { Purchase } from "../payments/link.ts";
import { checkLimits, createSpendTables, recordPurchase, setLimit } from "../payments/spend-approvals.ts";
import { type Editor, PageStore } from "../pages/pages.ts";
import { addSkill, createSkillsTable, deleteSkill, listSkills, shareSkill, type SkillInput, updateSkill } from "../skills/library.ts";
import { createFilesTable, type FileMeta, getFile, listFiles, putFile } from "./files.ts";
import { createOutboxTable, flushJournal, type JournalEntry, recordJournal } from "./journal.ts";
import { createVaultTable, type RevealPurpose, type VaultInput, vaultDelete, vaultList, vaultPut, vaultReveal } from "./vault.ts";
import { PLAN } from "../billing/plans.ts";
import { unitCost } from "./balance.ts";

const workspacePrefix = (accountId: string, generation: number) => `computers/${accountId}/${String(generation).padStart(8, "0")}/`;

async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		yield value;
	}
}

/** How soon a journal copy that failed is tried again. */
const JOURNAL_RETRY_MS = 30_000;

export class UserObject extends DurableObject<Env> {
	readonly #sql: SqlStorage;
	#pages: PageStore | undefined;
	#inbox: Inbox | undefined;
	#dataKey: Promise<CryptoKey> | undefined;
	#credentials: SealedCredentialStore | undefined;
	readonly #desktop: DesktopLink;
	readonly #hub: ThreadHub;
	readonly #state: AccountState;
	/** Purged: this instance writes nothing more. */
	#deleted = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql = ctx.storage.sql;
		this.#desktop = new DesktopLink(ctx, env, () => this.#accountId);
		this.#hub = new ThreadHub(ctx, env, () => this.#accountId);
		this.#state = new AccountState(this.#sql);
		ctx.blockConcurrencyWhile(async () => {
			this.#sql.exec("CREATE TABLE IF NOT EXISTS data_key (id INTEGER PRIMARY KEY CHECK (id = 1), wrapped TEXT NOT NULL)");
			createVaultTable(this.#sql);
			createCredentialsTable(this.#sql);
			createEnrollmentTable(this.#sql);
			balance.createBalanceTables(this.#sql);
			createOutboxTable(this.#sql);
			createFilesTable(this.#sql);
			createSkillsTable(this.#sql);
			createSpendTables(this.#sql);
			createUsageTable(this.#sql);
			createPushTables(this.#sql);
			createDocsTable(this.#sql);
			this.#sql.exec("CREATE TABLE IF NOT EXISTS bank_links (item_id TEXT PRIMARY KEY, accounts INTEGER NOT NULL, renews_at INTEGER NOT NULL, unpaid_since INTEGER)");
			this.#sql.exec("CREATE TABLE IF NOT EXISTS user_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
			// Entries an earlier instance could not copy are copied soon.
			if (this.#sql.exec("SELECT 1 FROM journal_outbox LIMIT 1").toArray().length > 0)
				await ctx.storage.setAlarm(Date.now() + JOURNAL_RETRY_MS);
		});
	}

	// ─── The desktop link ─────────────────────────────────────────────────────

	/** The desktop app's outbound socket; its first frame must be a ticket for this account. */
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
		return new URL(request.url).pathname.endsWith("/link") ? this.#desktop.accept() : this.#hub.accept();
	}
	override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (this.ctx.getTags(socket).includes("client")) return this.#hub.message(socket, message);
		await this.#desktop.message(socket, message);
	}
	override webSocketClose(socket: WebSocket, code: number): void {
		try {
			socket.close(code, "closed");
		} catch {
			// Already closed.
		}
		if (this.ctx.getTags(socket).includes("client")) return this.#hub.closed();
		this.#desktop.closed();
	}

	/** An account event to every open client (a bot changed, an inbox item, an approval, the computer). */
	broadcast(event: ServerEvent): void {
		this.#hub.broadcast(event);
	}
	desktopOnline(): boolean {
		return this.#desktop.online();
	}
	/** One command on the owner's computer; the desktop asks the owner first when it should. */
	desktopExec(botId: string, session: string, command: string): Promise<ExecResult> {
		return this.#desktop.exec({ botId, session, command });
	}

	/** The account this object belongs to (its name). */
	get #accountId(): string {
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	/** The account's data key, created on first use and stored wrapped by the key-encryption key. */
	#key(): Promise<CryptoKey> {
		this.#dataKey ??= (async () => {
			const kek = await getKek(this.env);
			const row = this.#sql.exec<{ wrapped: string }>("SELECT wrapped FROM data_key WHERE id = 1").toArray()[0];
			if (row) return unwrapDataKey(kek, row.wrapped);
			const { wrapped } = await createDataKey(kek);
			// Another call may have stored one meanwhile; the first stored key wins.
			this.#sql.exec("INSERT OR IGNORE INTO data_key (id, wrapped) VALUES (1, ?)", wrapped);
			return unwrapDataKey(kek, this.#sql.exec<{ wrapped: string }>("SELECT wrapped FROM data_key WHERE id = 1").one().wrapped);
		})();
		this.#dataKey.catch(() => {
			this.#dataKey = undefined;
		});
		return this.#dataKey;
	}

	// ─── Vault ────────────────────────────────────────────────────────────────

	async vaultPut(item: VaultInput): Promise<VaultItem> {
		return vaultPut(this.#sql, await this.#key(), item, devVaultOrigins(this.env));
	}

	vaultList(): VaultItem[] {
		return vaultList(this.#sql);
	}

	vaultDelete(id: string): void {
		vaultDelete(this.#sql, id);
	}

	/** For server-side tool code only: no client route reaches this. */
	async vaultReveal(id: string, purpose: RevealPurpose): Promise<string> {
		return vaultReveal(this.#sql, await this.#key(), id, purpose);
	}

	// ─── Model provider credentials ───────────────────────────────────────────

	/** The account's provider credentials for @knightcode/ai, with `modify` serialized per provider. */
	credentials(): CredentialStore {
		this.#credentials ??= new SealedCredentialStore(this.#sql, () => this.#key());
		return this.#credentials;
	}

	// The store over RPC, for the account's bot objects (a function argument arrives as a stub).
	credentialRead(provider: string): Promise<Credential | undefined> {
		return this.credentials().read(provider);
	}
	credentialList(): Promise<readonly CredentialInfo[]> {
		return this.credentials().list();
	}
	credentialModify(
		provider: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		return this.credentials().modify(provider, fn);
	}
	credentialDelete(provider: string): Promise<void> {
		return this.credentials().delete(provider);
	}

	/** Whether `provider` has usable auth, refreshing an expired OAuth token (once, however many ask at a time). */
	async resolveAuth(provider: string): Promise<boolean> {
		const models = withDevModels(this.env, builtinModels({ credentials: this.credentials() }));
		return (await models.getAuth(provider)) !== undefined;
	}

	async beginEnrollment(provider: string): Promise<{ token: string; expiresAt: number }> {
		return beginEnrollment(this.#sql, provider);
	}

	/** Stores the credential a fresh desktop sign-in produced, if the token is good, unused and for its provider. */
	async completeEnrollment(token: string, credential: Credential): Promise<void> {
		const provider = await spendEnrollment(this.#sql, token);
		if (!provider) throw new Error("enrollment token is unknown, used or expired");
		await this.credentials().modify(provider, async () => credential);
	}

	// ─── Balance ──────────────────────────────────────────────────────────────

	async reserve(kind: MeteredKind, units: number): Promise<Reservation | "insufficient"> {
		// A lapsed plan stops every metered extra; the trial has no bank links or Composio overage.
		if (!this.planAllows(kind === "bank" ? "bank" : kind === "composio" ? "composio_overage" : "computer")) return "insufficient";
		const result = balance.reserve(this.#sql, kind, units, this.#journal);
		await this.#flush();
		return result;
	}

	async settle(reservationId: string, usedUnits: number): Promise<void> {
		balance.settle(this.#sql, reservationId, usedUnits, this.#journal);
		await this.#flush();
	}

	balance(): Balance {
		return balance.balance(this.#sql);
	}

	/** Adds credit once per `key` (a payment's id). */
	async grantCredits(cents: number, key: string): Promise<void> {
		balance.grantCredits(this.#sql, cents, key, this.#journal);
		await this.#flush();
	}

	async setSpendingLimit(cents: number | null): Promise<void> {
		balance.setSpendingLimit(this.#sql, cents, this.#journal);
		await this.#flush();
	}

	readonly #journal = (entry: JournalEntry) => recordJournal(this.#sql, entry);

	/**
	 * Copies the journal outbox to D1. A failure never fails the change it records (that is already stored, and the
	 * caller holds its result); the outbox keeps the entries and this object's alarm copies them later.
	 */
	async #flush(): Promise<void> {
		try {
			await flushJournal(this.#sql, this.env.DB, this.#accountId);
		} catch (error) {
			console.error("journal copy", error);
			await this.ctx.storage.setAlarm(Date.now() + JOURNAL_RETRY_MS);
		}
	}

	override async alarm(): Promise<void> {
		if (this.#deleted) return;
		// A deleted account's object, woken by an alarm a lost instance left: it removes itself instead.
		if (await isDeleted(this.env.DB, this.#accountId)) return this.purge();
		await this.#flush();
		await this.flushPushes();
		await this.renewBankLinks().catch((error: unknown) => console.error("bank renewal", error));
	}

	// ─── The client's account ─────────────────────────────────────────────────

	async account(): Promise<Account> {
		const row = await this.env.DB.prepare("SELECT id, name, email, workspace_id, created_at FROM accounts WHERE id = ?")
			.bind(this.#accountId)
			.first<{ id: string; name: string | null; email: string | null; workspace_id: string | null; created_at: number }>();
		const handle = await this.env.DB.prepare("SELECT handle FROM handles WHERE account_id = ?").bind(this.#accountId).first<{ handle: string }>();
		const profile = this.#state.profile();
		const plan = this.plan();
		return {
			id: this.#accountId,
			workspaceId: row?.workspace_id ?? this.#accountId,
			name: profile.name ?? row?.name ?? "",
			...(row?.email ? { email: row.email } : {}),
			...(handle ? { handle: handle.handle } : {}),
			timeZone: profile.timeZone,
			plan: plan === "trialing" ? "trial" : plan,
			...(profile.defaultModel ? { defaultModel: profile.defaultModel } : {}),
			helperModels: profile.helperModels,
			createdAt: row?.created_at ?? 0,
		};
	}
	async updateAccount(patch: Partial<Pick<Account, "name" | "timeZone" | "defaultModel" | "helperModels">>): Promise<Account> {
		this.#state.updateProfile(patch);
		return this.account();
	}

	sidebar() {
		return this.#state.sidebar();
	}
	setBotFlags(botId: string, flags: BotFlags): void {
		this.#state.setBotFlags(botId, flags);
	}
	setGroupFlags(groupId: string, flags: GroupFlags): void {
		this.#state.setGroupFlags(groupId, flags);
	}
	setSections(sections: Section[]): Section[] {
		return this.#state.setSections(sections);
	}
	reactions(thread: string) {
		return this.#state.reactions(thread);
	}
	react(thread: string, entryId: string, emoji: string) {
		return this.#state.react(thread, entryId, emoji);
	}
	sharedMemory() {
		return this.#state.sharedMemory();
	}
	addSharedNotes(notes: Note[]): void {
		this.#state.addSharedNotes(notes);
	}

	/** The getting-started checklist: what the user has done since signing up, each step marked when it happens. */
	onboarding(): Onboarding {
		const done = readDoc(this.#sql, "onboarding", () => ({}) as Record<string, boolean>);
		return { items: ONBOARDING.map((id) => ({ id, done: done[id] === true })) };
	}
	markOnboarding(id: (typeof ONBOARDING)[number]): void {
		updateDoc(this.#sql, "onboarding", () => ({}) as Record<string, boolean>, (done) => {
			done[id] = true;
		});
	}

	/** The catch-up for the time the user was away (none when they were not away long). */
	async catchUpNow() {
		const now = Date.now();
		const seen = this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = 'last_activity'").toArray()[0]?.value;
		// Since the user was last here (an account never seen: the last four hours, the catch-up's own window).
		const since = seen ? Number(seen) : now - AWAY_MS;
		this.touch(now);
		const items = this.inbox.since(since);
		if (items.length === 0) return null;
		return {
			since,
			summary: `${items.length} update${items.length === 1 ? "" : "s"} while you were away.`,
			finished: items.filter((item) => item.kind === "review"),
			waiting: items.filter((item) => item.kind === "approval" || item.kind === "question"),
			failed: items.filter((item) => item.kind === "failure"),
		};
	}

	searchAccount(needle: string) {
		const hits: { kind: "page" | "skill"; id: string; title: string; snippet?: string }[] = [];
		for (const page of this.pages.list(needle)) hits.push({ kind: "page", id: page.id, title: page.title });
		for (const skill of this.skillList({ q: needle })) hits.push({ kind: "skill", id: skill.id, title: skill.name, snippet: skill.description });
		return hits;
	}

	// ─── Providers and models ─────────────────────────────────────────────────

	async providers(): Promise<ProviderConnection[]> {
		const models = withDevModels(this.env, builtinModels({ credentials: this.credentials() }));
		const held = new Set((await this.credentialList()).map((item) => item.providerId));
		return models.getProviders().map((provider) => ({
			provider: provider.id,
			name: provider.name,
			kind: provider.auth.oauth ? "oauth" : "api_key",
			status: held.has(provider.id) ? "connected" : "available",
			...(provider.id === "anthropic" ? { note: "Bots' usage bills to your Claude extra usage, not your plan's included limits." } : {}),
		}));
	}
	async connectApiKey(provider: string, key: string): Promise<ProviderConnection> {
		await this.credentials().modify(provider, async () => ({ type: "api_key", key }) as Credential);
		this.markOnboarding("providers");
		const found = (await this.providers()).find((candidate) => candidate.provider === provider);
		return found ?? { provider, name: provider, kind: "api_key", status: "connected" };
	}
	async completeEnrollmentFor(provider: string, token: string, credential: Credential): Promise<ProviderConnection | undefined> {
		const enrolled = await spendEnrollment(this.#sql, token);
		if (!enrolled || enrolled !== provider) return undefined;
		await this.credentials().modify(provider, async () => credential);
		this.markOnboarding("providers");
		return (await this.providers()).find((candidate) => candidate.provider === provider);
	}
	/** The models the account's connected providers offer; the user picks each model. */
	async models(): Promise<ModelOption[]> {
		const models = await withDevModels(this.env, builtinModels({ credentials: this.credentials() })).getAvailable();
		return models.map((model) => ({
			provider: model.provider,
			modelId: model.id,
			name: model.name,
			thinking: model.reasoning ? ["low", "medium", "high"] : [],
			images: model.input.includes("image"),
		}));
	}

	// ─── Files and pages ──────────────────────────────────────────────────────

	fileRef(id: string): FileRef | undefined {
		return this.listFiles().find((ref) => ref.id === id);
	}
	/** Where the signed-in user downloads a file: the Worker serves it after checking the session. */
	fileUrl(id: string): string {
		return `/api/files/${encodeURIComponent(id)}/content`;
	}
	async deleteFile(id: string): Promise<void> {
		this.#sql.exec("DELETE FROM files WHERE id = ?", id);
		await this.env.FILES.delete(`files/${this.#accountId}/${id}`);
	}
	pageVersions(id: string) {
		return this.pages.versions(id).map((version) => ({ version: version.version, updatedAt: version.at, author: version.author }));
	}
	pageVersion(id: string, version: number): Page | undefined {
		return this.pages.version(id, version);
	}
	pageRestore(id: string, version: number): Page {
		const old = this.pageVersion(id, version);
		if (!old) throw new Error(`no version ${version} of ${id}`);
		return this.pages.update(id, { kind: "user" }, { title: old.title, blocks: old.blocks });
	}
	async pageExport(id: string, _format: "markdown" | "pdf"): Promise<string> {
		const page = this.pages.get(id);
		if (!page) throw new Error(`no page ${id}`);
		// ponytail: both formats export Markdown; a PDF renderer is owed.
		const file = await this.putFile({ name: `${page.title}.md`, kind: "bot-output", botId: page.ownerBotId, mime: "text/markdown" }, this.pages.markdown(id));
		return file.id;
	}

	// ─── Inbox and tasks ──────────────────────────────────────────────────────

	inboxAll(): { items: InboxItem[]; tasks: Task[] } {
		return { items: this.inbox.list({ includeDone: true }), tasks: this.inbox.tasks() };
	}
	inboxMark(id: string, patch: { pinned?: boolean; done?: boolean; read?: boolean }): InboxItem | undefined {
		this.inbox.mark(id, patch);
		return this.inbox.list({ includeDone: true }).find((item) => item.id === id);
	}
	taskAdd(task: { title: string; ownerBotId?: string; due?: number; source: Task["source"] }): Task {
		return this.inbox.addTask(task);
	}
	taskUpdate(id: string, patch: { title?: string; status?: Task["status"]; due?: number }): Task {
		if (patch.status) this.inbox.setTask(id, patch.status);
		if (patch.title !== undefined) this.#sql.exec("UPDATE tasks SET title = ? WHERE id = ?", patch.title, id);
		if (patch.due !== undefined) this.#sql.exec("UPDATE tasks SET due = ? WHERE id = ?", patch.due, id);
		const task = this.inbox.tasks().find((candidate) => candidate.id === id);
		if (!task) throw new Error(`no task ${id}`);
		return task;
	}

	// ─── Settings ─────────────────────────────────────────────────────────────

	approvalSettings(): ApprovalSettings {
		return this.#state.approvalSettings();
	}
	updateApprovalSettings(patch: Partial<ApprovalSettings>): ApprovalSettings {
		this.markOnboarding("approvals");
		return this.#state.updateApprovalSettings(patch);
	}
	homeRouting(): HomeRouting {
		return this.#state.homeRouting();
	}
	/**
	 * A page loaded through the owner's own connection when home routing goes through the desktop app (spec section 7):
	 * an HTTP/1.1 GET over a connection the desktop makes. Undefined means "go direct" (routing off, or the link is down
	 * and the owner chose to fall back to the cloud); with fail-closed and no link, the traffic stops.
	 */
	async homeFetch(url: string): Promise<{ ok: true; status: number; body: string } | { ok: false; error: string } | undefined> {
		const routing = this.homeRouting();
		if (!routing.enabled || routing.route !== "desktop") return undefined;
		const target = new URL(url);
		// ponytail: plain HTTP only here; HTTPS through the route needs the container's CONNECT proxy (TLS in Chrome).
		if (target.protocol !== "http:") return { ok: false, error: "Only http:// pages load through the home route here." };
		const chunks: Uint8Array[] = [];
		let finish: (reason?: string) => void = () => {};
		const done = new Promise<string | undefined>((resolve) => (finish = resolve));
		const tunnel = await this.#desktop.tunnel(target.hostname, Number(target.port || 80), { data: (bytes) => void chunks.push(bytes), closed: (reason) => finish(reason) });
		if (!tunnel) return routing.failClosed ? { ok: false, error: "Home routing is on and the desktop app is offline, so traffic is stopped." } : undefined;
		const head = [`GET ${target.pathname}${target.search} HTTP/1.1`, `Host: ${target.host}`, "User-Agent: KnightCode Bots", "Connection: close", "", ""];
		tunnel.write(new TextEncoder().encode(head.join("\r\n")));
		const timer = setTimeout(() => finish("timeout"), 30_000);
		const reason = await done;
		clearTimeout(timer);
		tunnel.close();
		if (reason && reason !== "end") return { ok: false, error: `The home route could not reach ${target.host} (${reason}).` };
		const text = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk])));
		const split = text.indexOf("\r\n\r\n");
		const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1] ?? 0);
		if (split < 0 || !status) return { ok: false, error: `${target.host} sent no HTTP answer.` };
		return { ok: true, status, body: text.slice(split + 4) };
	}
	updateHomeRouting(patch: Partial<HomeRouting>): HomeRouting {
		return this.#state.updateHomeRouting(patch);
	}
	tailscale(): Tailscale {
		return this.#state.tailscale();
	}
	async joinTailscale(authKey: string, exitNode?: string): Promise<Tailscale> {
		await this.credentials().modify("tailscale", async () => ({ type: "api_key", key: authKey }) as Credential);
		return this.#state.setTailscale({ joined: true, hasKey: true, ...(exitNode ? { exitNode } : {}) });
	}
	async leaveTailscale(): Promise<Tailscale> {
		await this.credentials().delete("tailscale");
		return this.#state.setTailscale({ joined: false, hasKey: false });
	}

	payments(): Payments {
		const limits = this.#sql
			.exec<{ bot_id: string; per_purchase: number; per_month: number }>("SELECT * FROM spend_limits")
			.toArray()
			.map((row) => ({ botId: row.bot_id, perPurchase: row.per_purchase / 100, perMonth: row.per_month / 100 }));
		return { available: paymentsAvailable(this.env, this.country()), linked: readDoc(this.#sql, "wallet", () => null) !== null, limits };
	}
	async linkWallet(returnUrl: string): Promise<{ url: string }> {
		if (!this.env.STRIPE_SECRET_KEY) throw new Error("payments are not set up");
		const wallet = await new StripeLinkProvider({ secretKey: this.env.STRIPE_SECRET_KEY, apiUrl: this.env.STRIPE_API_URL }).linkWallet({ accountId: this.#accountId, returnUrl });
		writeDoc(this.#sql, "wallet", { customerId: wallet.customerId });
		return { url: wallet.url };
	}
	setSpendLimits(limits: SpendLimit[]): Payments {
		this.#sql.exec("DELETE FROM spend_limits");
		for (const limit of limits) setLimit(this.#sql, limit.botId, { perPurchase: limit.perPurchase * 100, perMonth: limit.perMonth * 100 });
		return this.payments();
	}

	async finance(): Promise<Finance> {
		const types: Record<string, Finance["accounts"][number]["type"]> = { depository: "bank", credit: "card", loan: "loan", investment: "brokerage", brokerage: "brokerage" };
		const accounts = financeAvailable(this.country()) ? await this.bankAccounts().catch(() => []) : [];
		return {
			available: financeAvailable(this.country()),
			accounts: accounts.map((account) => ({ id: account.id, name: account.name, type: types[account.type] ?? "bank", mask: account.mask, balance: account.balance, currency: account.currency })),
		};
	}
	async bankLinkToken(): Promise<string> {
		if (!this.planAllows("bank")) throw new Error("bank links are not available on this plan");
		return this.#plaid().linkToken(this.#accountId, this.country() ?? "US");
	}
	/** Unlinks the bank item holding account `accountId` (Plaid links a bank's accounts together). */
	async unlinkBank(accountId: string): Promise<void> {
		for (const item of (await this.credentials().list()).filter((entry) => entry.providerId.startsWith("plaid:"))) {
			const credential = (await this.credentials().read(item.providerId)) as { key?: string } | undefined;
			if (!credential?.key) continue;
			const accounts = await this.#plaid().accounts(credential.key).catch(() => []);
			if (!accounts.some((account) => account.id === accountId)) continue;
			await this.#plaid().removeItem(credential.key);
			await this.credentials().delete(item.providerId);
			this.#sql.exec("DELETE FROM bank_links WHERE item_id = ?", item.providerId.slice("plaid:".length));
		}
	}

	// ─── Channels ─────────────────────────────────────────────────────────────

	async channels(): Promise<Channels> {
		const links = await this.env.DB.prepare("SELECT channel, external_chat, bot_id, mode, created_at FROM channel_links WHERE account_id = ? ORDER BY created_at")
			.bind(this.#accountId)
			.all<{ channel: "telegram" | "slack" | "email"; external_chat: string; bot_id: string; mode: string; created_at: number }>();
		const slack = await this.env.DB.prepare("SELECT 1 AS hit FROM slack_teams WHERE account_id = ?").bind(this.#accountId).first();
		const addresses = await this.env.DB.prepare("SELECT bot_id, address FROM bot_addresses WHERE account_id = ?").bind(this.#accountId).all<{ bot_id: string; address: string }>();
		const extras = readDoc(this.#sql, "channel-links", () => ({}) as Record<string, { rules?: string }>);
		return {
			links: links.results.map((row) => ({
				id: `${row.channel}:${row.external_chat}`,
				channel: row.channel,
				botId: row.bot_id,
				externalId: row.external_chat,
				label: row.channel === "slack" ? `Slack ${row.external_chat}` : row.channel === "telegram" ? `Telegram chat ${row.external_chat}` : row.external_chat,
				...(row.mode === "mentions" || row.mode === "listen" ? { mode: row.mode } : {}),
				...(extras[`${row.channel}:${row.external_chat}`]?.rules ? { rules: extras[`${row.channel}:${row.external_chat}`]!.rules } : {}),
				createdAt: row.created_at,
			})),
			slackInstalled: slack !== null,
			addresses: addresses.results.map((row) => ({ botId: row.bot_id, address: row.address })),
		};
	}
	telegramCode(botId: string) {
		return issueLinkCode(this.env.DB, { channel: "telegram", accountId: this.#accountId, botId });
	}
	async linkSlackDms(botId: string): Promise<ProtocolChannelLink> {
		const team = await this.env.DB.prepare("SELECT team_id, owner_user_id FROM slack_teams WHERE account_id = ?")
			.bind(this.#accountId)
			.first<{ team_id: string; owner_user_id: string | null }>();
		if (!team) throw new Error("Slack is not installed for this account");
		// The DMs of the Slack user who installed the app (inbound DMs are keyed "<team>:<user>"); nobody else's.
		if (!team.owner_user_id) throw new Error("Reinstall the Slack app to link your direct messages");
		const externalChat = `${team.team_id}:${team.owner_user_id}`;
		const now = Date.now();
		await this.env.DB.prepare("INSERT OR REPLACE INTO channel_links (channel, external_chat, account_id, bot_id, mode, created_at) VALUES ('slack', ?, ?, ?, 'direct', ?)")
			.bind(externalChat, this.#accountId, botId, now)
			.run();
		this.markOnboarding("chat-app");
		return { id: `slack:${externalChat}`, channel: "slack", botId, externalId: externalChat, label: "Slack direct messages", createdAt: now };
	}
	async updateChannelLink(id: string, patch: { botId?: string; mode?: "mentions" | "listen"; rules?: string }): Promise<ProtocolChannelLink | undefined> {
		const [channel, ...rest] = id.split(":");
		const externalChat = rest.join(":");
		if (patch.botId || patch.mode)
			await this.env.DB.prepare("UPDATE channel_links SET bot_id = COALESCE(?, bot_id), mode = COALESCE(?, mode) WHERE channel = ? AND external_chat = ? AND account_id = ?")
				.bind(patch.botId ?? null, patch.mode ?? null, channel, externalChat, this.#accountId)
				.run();
		if (patch.rules !== undefined)
			updateDoc(this.#sql, "channel-links", () => ({}) as Record<string, { rules?: string }>, (extras) => {
				extras[id] = { ...extras[id], rules: patch.rules };
			});
		return (await this.channels()).links.find((link) => link.id === id);
	}
	async deleteChannelLink(id: string): Promise<void> {
		const [channel, ...rest] = id.split(":");
		await this.env.DB.prepare("DELETE FROM channel_links WHERE channel = ? AND external_chat = ? AND account_id = ?").bind(channel, rest.join(":"), this.#accountId).run();
	}

	// ─── Billing view ─────────────────────────────────────────────────────────

	billing(): Billing {
		const plan = this.plan();
		const current = this.balance();
		const meta = (key: string) => this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = ?", key).toArray()[0]?.value;
		const usedBytes = this.#sql.exec<{ total: number | null }>("SELECT SUM(size) AS total FROM files").one().total ?? 0;
		const computerCents = this.#sql.exec<{ total: number | null }>("SELECT SUM(used) AS total FROM reservations WHERE kind = 'computer' AND state = 'settled'").one().total ?? 0;
		return {
			plan: plan === "trialing" ? "trial" : plan,
			...(meta("trial_ends_at") ? { trialEndsAt: Number(meta("trial_ends_at")) } : {}),
			...(meta("renews_at") && meta("cancel_at_period_end") !== "1" ? { renewsAt: Number(meta("renews_at")) } : {}),
			computerHours: { used: Math.round((computerCents / unitCost("computer") / 12) * 10) / 10, included: plan === "trialing" ? PLAN.trialComputerHours : PLAN.includedComputerHours },
			storage: { usedBytes, includedBytes: PLAN.storageGb * 1024 ** 3 },
			credits: current.credits / 100,
			spendingLimit: current.limit === null ? null : current.limit / 100,
			autoTopUp: this.#state.autoTopUp(),
			receipts: this.#state.receipts(),
		};
	}
	cancelAtPeriodEnd(): Billing {
		this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES ('cancel_at_period_end', '1')");
		return this.billing();
	}
	async setSpendingLimitDollars(limit: number | null): Promise<Billing> {
		await this.setSpendingLimit(limit === null ? null : Math.round(limit * 100));
		await this.env.COMPUTER.get(this.env.COMPUTER.idFromName(this.#accountId)).budgetChanged();
		return this.billing();
	}
	setAutoTopUp(value: { enabled: boolean; threshold?: number; amount?: number }) {
		this.#state.setAutoTopUp(value);
		return this.billing();
	}
	usageRows(from?: number, to?: number): UsageRow[] {
		return this.#sql
			.exec<{ bot_id: string; routine_id: string | null; model: string; runs: number; input: number; output: number; cost: number; day: string }>(
				"SELECT bot_id, routine_id, model, COUNT(*) AS runs, SUM(input) AS input, SUM(output) AS output, SUM(cost) AS cost, strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day FROM usage WHERE at >= ? AND at <= ? GROUP BY bot_id, routine_id, model, day ORDER BY day DESC",
				from ?? 0,
				to ?? Number.MAX_SAFE_INTEGER,
			)
			.toArray()
			.map((row) => {
				const [provider, ...rest] = row.model.split("/");
				return {
					botId: row.bot_id,
					...(row.routine_id ? { routineId: row.routine_id } : {}),
					model: { provider: provider ?? "", modelId: rest.join("/") },
					runs: row.runs,
					inputTokens: row.input,
					outputTokens: row.output,
					costUsd: row.cost,
					day: row.day,
				};
			});
	}

	// ─── Connectors ───────────────────────────────────────────────────────────

	#connections(): Record<string, { status: "connected"; connectedAt: number; usageNote?: string; permissions?: CatalogEntry["permissions"] }> {
		return readDoc(this.#sql, "connections", () => ({}));
	}

	/** The catalog (curated servers, indexed plugins, the account's own servers) with this account's connections. */
	#composio(): ComposioClient | undefined {
		return this.env.COMPOSIO_API_KEY ? new ComposioClient({ apiKey: this.env.COMPOSIO_API_KEY, ...(this.env.COMPOSIO_BASE_URL ? { baseUrl: this.env.COMPOSIO_BASE_URL } : {}) }) : undefined;
	}
	#composioCache?: { at: number; entries: CatalogEntry[] };
	/** Composio's toolkits, kept for ten minutes; the catalog works without them when Composio is down. */
	async #composioEntries(): Promise<CatalogEntry[]> {
		const client = this.#composio();
		if (!client) return [];
		if (this.#composioCache && Date.now() - this.#composioCache.at < 10 * 60_000) return this.#composioCache.entries;
		const entries = await client.catalog().catch((error: unknown) => {
			console.error("composio catalog", error);
			return this.#composioCache?.entries ?? [];
		});
		this.#composioCache = { at: Date.now(), entries };
		return entries;
	}
	async #sources(): Promise<CatalogSource[]> {
		const plugins = await this.env.DB.prepare("SELECT entry FROM plugin_catalog").all<{ entry: string }>().catch(() => ({ results: [] as { entry: string }[] }));
		return [
			{ kind: "curated", entries: curatedEntries() },
			{ kind: "plugins", entries: plugins.results.map((row) => JSON.parse(row.entry) as CatalogEntry) },
			{ kind: "composio", entries: await this.#composioEntries() },
		];
	}
	async catalog(filter: { q?: string; category?: CatalogEntry["category"] } = {}): Promise<CatalogEntry[]> {
		const custom = readDoc(this.#sql, "custom-servers", () => [] as CatalogEntry[]);
		const merged = [...mergeCatalog(await this.#sources()), ...custom];
		const connections = this.#connections();
		const needle = filter.q?.toLowerCase();
		return merged
			.filter((entry) => (filter.category === undefined || entry.category === filter.category) && (!needle || `${entry.name} ${entry.maker} ${entry.description}`.toLowerCase().includes(needle)))
			.map((entry) => {
				const connection = connections[entry.id];
				if (!connection) return entry;
				const { status, connectedAt, usageNote, permissions } = connection;
				return { ...entry, connection: { status, connectedAt }, ...(usageNote ? { usageNote } : {}), ...(permissions ? { permissions } : {}) };
			});
	}
	async appEvents(appId: string): Promise<{ id: string; name: string; description: string }[]> {
		const entry = (await this.catalog()).find((candidate) => candidate.id === appId);
		// ponytail: an app's trigger events come from Composio's trigger catalog, not wired yet; none are listed.
		return entry ? [] : [];
	}
	async connectApp(appId: string, options: { skills: boolean; apiKey?: string }): Promise<{ entry: CatalogEntry; authorizeUrl?: string }> {
		const entry = (await this.catalog()).find((candidate) => candidate.id === appId);
		if (!entry) throw new Error(`no app ${appId}`);
		if (options.apiKey) await this.credentials().modify(`app:${appId}`, async () => ({ type: "api_key", key: options.apiKey! }) as Credential);
		// A Composio-backed app: the user signs in on Composio's page, which holds the app's tokens (spec section 9).
		let authorizeUrl: string | undefined;
		const composio = sourceOf(await this.#sources(), appId) === "composio" ? this.#composio() : undefined;
		if (composio) {
			// ponytail: the toolkit slug stands in for the auth config id; confirm against Composio's API before launch.
			const started = await composio.connect(appId, this.#accountId, `${appOrigin(this.env)}/connectors/${encodeURIComponent(appId)}`);
			await this.env.DB.prepare("INSERT OR REPLACE INTO composio_accounts (connected_account_id, account_id, app_id) VALUES (?, ?, ?)")
				.bind(started.connectionId, this.#accountId, appId)
				.run();
			authorizeUrl = started.redirectUrl;
		}
		updateDoc(this.#sql, "connections", () => ({}) as ReturnType<UserObject["connectionsDoc"]>, (connections) => {
			connections[appId] = { ...connections[appId], status: "connected", connectedAt: Date.now() };
		});
		this.markOnboarding("app");
		if (options.skills)
			for (const skill of entry.skills)
				if (!this.skillList({ scope: "app" }).some((existing) => existing.appId === appId && existing.name === skill.name))
					this.skillAdd({ name: skill.name, description: skill.description, content: skill.description, scope: "app", appId });
		return { entry: (await this.catalog()).find((candidate) => candidate.id === appId)!, ...(authorizeUrl ? { authorizeUrl } : {}) };
	}
	connectionsDoc() {
		return this.#connections();
	}
	async disconnectApp(appId: string): Promise<void> {
		// A Composio connection is revoked there too, so its tokens do not outlive the connection.
		const held = await this.env.DB.prepare("SELECT connected_account_id AS id FROM composio_accounts WHERE account_id = ? AND app_id = ?").bind(this.#accountId, appId).all<{ id: string }>();
		const composio = this.#composio();
		for (const { id } of held.results)
			if (composio && (await composio.deleteConnection(id))) await this.env.DB.prepare("DELETE FROM composio_accounts WHERE connected_account_id = ?").bind(id).run();
		updateDoc(this.#sql, "connections", () => ({}) as ReturnType<UserObject["connectionsDoc"]>, (connections) => {
			delete connections[appId];
		});
		await this.credentials().delete(`app:${appId}`);
	}
	async updateConnection(appId: string, patch: { usageNote?: string; permissions?: CatalogEntry["permissions"] }): Promise<CatalogEntry> {
		updateDoc(this.#sql, "connections", () => ({}) as ReturnType<UserObject["connectionsDoc"]>, (connections) => {
			const current = connections[appId];
			if (!current) throw new Error(`${appId} is not connected`);
			connections[appId] = { ...current, ...(patch.usageNote !== undefined ? { usageNote: patch.usageNote } : {}), ...(patch.permissions ? { permissions: patch.permissions } : {}) };
		});
		return (await this.catalog()).find((candidate) => candidate.id === appId)!;
	}
	async addCustomServer(name: string, url: string): Promise<CatalogEntry> {
		const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";
		const existing = new Set((await this.catalog()).map((entry) => entry.id));
		let id = base;
		for (let n = 2; existing.has(id); n++) id = `${base}-${n}`;
		const entry: CatalogEntry = {
			id,
			name,
			maker: new URL(url).host,
			category: "developer",
			icon: "custom",
			description: url,
			auth: "oauth",
			skills: [],
			permissions: { reads: "auto", writes: "approval", tools: {} },
		};
		updateDoc(this.#sql, "custom-servers", () => [] as CatalogEntry[], (servers) => [...servers, entry]);
		return entry;
	}

	// ─── Development seeding ──────────────────────────────────────────────────

	/** Development only (BOTS_DEV_SEED): the account-level part of a FakeSeed. */
	async importSeed(seed: FakeSeed): Promise<void> {
		if (this.env.BOTS_DEV_SEED !== "1") throw new Error("seeding is off");
		this.#state.importSeed(seed);
		writeDoc(this.#sql, "onboarding", Object.fromEntries(seed.onboarding.items.map((item) => [item.id, item.done])));
		// The world's own "last here": the catch-up shows what happened since.
		if (seed.catchUp) this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES ('last_activity', ?)", String(Math.min(seed.catchUp.since, Date.now() - AWAY_MS)));
		for (const page of seed.pages) {
			this.pages.import(page);
		}
		for (const skill of seed.skills) this.skillAdd({ name: skill.name, description: skill.description, content: skill.content, scope: skill.scope, ...(skill.botId ? { botId: skill.botId } : {}), ...(skill.appId ? { appId: skill.appId } : {}) });
		for (const item of seed.inbox) this.inbox.add({ kind: item.kind, botId: item.botId, title: item.title, ...(item.detail ? { detail: item.detail } : {}), ...(item.entryId ? { entryId: item.entryId } : {}), ...(item.approvalId ? { approvalId: item.approvalId } : {}) });
		for (const task of seed.tasks) this.inbox.addTask({ title: task.title, ...(task.ownerBotId ? { ownerBotId: task.ownerBotId } : {}), ...(task.due ? { due: task.due } : {}), source: task.source });
		writeDoc(this.#sql, "custom-servers", seed.catalog.filter((entry) => !curatedEntries().some((curated) => curated.id === entry.id)));
		writeDoc(
			this.#sql,
			"connections",
			Object.fromEntries(seed.catalog.filter((entry) => entry.connection).map((entry) => [entry.id, { status: "connected", connectedAt: entry.connection!.connectedAt ?? Date.now() }])),
		);
		for (const item of seed.vault) await this.vaultPut({ ...item, value: `seeded-${item.id}` } as VaultInput);
		this.setCountry("US");
		if (seed.billing.credits > 0) await this.grantCredits(Math.round(seed.billing.credits * 100), `seed:${this.#accountId}`);
		this.applyBilling([{ type: "plan", status: seed.billing.plan === "trial" ? "trialing" : seed.billing.plan, at: Date.now() }]);
		for (const limit of seed.payments.limits) setLimit(this.#sql, limit.botId, { perPurchase: limit.perPurchase * 100, perMonth: limit.perMonth * 100 });
	}

	// ─── Export and deletion ──────────────────────────────────────────────────

	/** Pages (with their blocks) and files (with their contents, base64) for the account export. */
	async exportData(): Promise<{ pages: unknown[]; files: { ref: FileRef; base64: string }[] }> {
		const pages = this.pages.list().map((summary) => this.pages.get(summary.id));
		const files = [];
		for (const ref of this.listFiles()) {
			const file = await this.getFile(ref.id);
			if (file) files.push({ ref, base64: btoa(Array.from(file.body, (byte) => String.fromCharCode(byte)).join("")) });
		}
		return { pages, files };
	}

	/**
	 * Revokes the account's bank links, then deletes everything this object holds (the data key with it) and its alarm.
	 * Returns the Stripe customer for the caller to delete.
	 */
	async purge(): Promise<void> {
		for (const socket of this.ctx.getWebSockets()) socket.close(4410, "account deleted");
		this.#deleted = true;
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
		// This instance's memory goes too: the next request meets a fresh object over the empty storage.
		setTimeout(() => {
			try {
				this.ctx.abort("purged");
			} catch {
				// The reset is under way; its unwinding is not an error.
			}
		}, 0);
	}

	/**
	 * Removes every bank link at Plaid; each one's token is forgotten only once Plaid confirms. A failure throws with the
	 * rest kept, so deletion stops and can run again.
	 */
	async revokeBanks(): Promise<number> {
		let removed = 0;
		for (const item of (await this.credentials().list()).filter((entry) => entry.providerId.startsWith("plaid:"))) {
			const credential = (await this.credentials().read(item.providerId)) as { key?: string } | undefined;
			if (credential?.key) await this.#plaid().removeItem(credential.key);
			await this.credentials().delete(item.providerId);
			this.#sql.exec("DELETE FROM bank_links WHERE item_id = ?", item.providerId.slice("plaid:".length));
			removed++;
		}
		return removed;
	}

	stripeCustomer(): string | undefined {
		return this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = 'stripe_customer'").toArray()[0]?.value;
	}

	// ─── Notifications ────────────────────────────────────────────────────────

	subscribePush(subscription: PushSubscription): void {
		addSubscription(this.#sql, subscription);
	}
	unsubscribePush(endpoint: string): void {
		removeSubscription(this.#sql, endpoint);
	}
	setPushPreviews(allowed: boolean): void {
		setPreviewsAllowed(this.#sql, allowed);
	}

	/** Activity in some app (or leaving it). Pushes wait while active and go out once the user is away. */
	async presence(active: boolean, now = Date.now()): Promise<void> {
		const until = markPresence(this.#sql, active, now);
		this.touch(now);
		if (active) await this.#alarmAt(until);
		else await this.flushPushes(now);
	}

	/** A bot finished or needs input: pushed now if the user is away, else held until they are. */
	async notify(notice: Notice, now = Date.now()): Promise<void> {
		const push = pushFor(notice, previewsAllowed(this.#sql));
		if (!push) return;
		hold(this.#sql, push);
		await this.flushPushes(now);
	}

	/** Sends what is held as one push, unless the user is still active (then the alarm comes back when they leave). */
	async flushPushes(now = Date.now()): Promise<void> {
		if (isActive(this.#sql, now)) return this.#alarmAt(Number(this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = 'active_until'").one().value));
		const push = takeHeld(this.#sql);
		if (!push || !this.env.VAPID_PUBLIC_KEY || !this.env.VAPID_PRIVATE_KEY) return;
		const keys = { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject: this.env.VAPID_SUBJECT ?? "mailto:support@knightcode.dev" };
		for (const subscription of subscriptions(this.#sql)) {
			const result = await sendPush(subscription, push, keys).catch(() => "failed" as const);
			if (result === "gone") removeSubscription(this.#sql, subscription.endpoint);
		}
	}

	/** The desktop's unread badge: inbox items not yet read. */
	badgeCount(): number {
		return this.inbox.list().filter((item) => !item.read).length;
	}

	async #alarmAt(at: number): Promise<void> {
		const current = await this.ctx.storage.getAlarm();
		if (current === null || current > at) await this.ctx.storage.setAlarm(at);
	}

	// ─── Files ────────────────────────────────────────────────────────────────

	async putFile(meta: FileMeta, body: string | Uint8Array | ArrayBuffer): Promise<FileRef> {
		return putFile(this.#sql, this.env.FILES, await this.#key(), this.#accountId, meta, body);
	}

	async getFile(id: string): Promise<{ ref: FileRef; body: Uint8Array } | undefined> {
		return getFile(this.#sql, this.env.FILES, await this.#key(), this.#accountId, id);
	}

	listFiles(filter: { botId?: string; kind?: FileKind } = {}): FileRef[] {
		return listFiles(this.#sql, filter);
	}

	// ─── Skills ───────────────────────────────────────────────────────────────

	skillAdd(input: SkillInput): Skill {
		return addSkill(this.#sql, input);
	}
	skillList(filter: { scope?: SkillScope; botId?: string; q?: string } = {}): Skill[] {
		return listSkills(this.#sql, filter);
	}
	skillUpdate(id: string, patch: Partial<Pick<SkillInput, "name" | "description" | "content">>): Skill {
		return updateSkill(this.#sql, id, patch);
	}
	skillShare(id: string): Skill {
		return shareSkill(this.#sql, id);
	}
	skillDelete(id: string): void {
		deleteSkill(this.#sql, id);
	}

	// ─── Pages and the inbox ──────────────────────────────────────────────────
	// The library and the inbox span all of the user's bots, so they live here.

	get pages(): PageStore {
		this.#pages ??= new PageStore(this.#sql);
		return this.#pages;
	}

	get inbox(): Inbox {
		this.#inbox ??= new Inbox(this.#sql);
		return this.#inbox;
	}

	pageCreate(ownerBotId: string, title: string, blocks: unknown, author: string) {
		return this.pages.create(ownerBotId, title, blocks, author);
	}
	pageUpdate(id: string, editor: Editor, change: { title?: string; blocks?: unknown; baseVersion?: number }) {
		return this.pages.update(id, editor, change);
	}
	pageGet(id: string) {
		return this.pages.get(id);
	}
	/** A routine ran: pages whose widgets read its output refresh from it, with no model call (spec section 19). */
	async refreshRoutineWidgets(ref: string, output: string): Promise<number> {
		let refreshed = 0;
		for (const summary of this.pages.list()) {
			const page = this.pages.get(summary.id);
			if (!page?.blocks.some((block) => block.type === "widget" && block.source.kind === "routine" && block.source.ref === ref)) continue;
			const blocks = await refreshPage(page.blocks, { routineOutput: async (wanted) => (wanted === ref ? output : undefined), connectorRead: async () => undefined, file: async () => undefined });
			this.pages.update(page.id, { kind: "bot", botId: page.ownerBotId }, { blocks });
			refreshed++;
		}
		return refreshed;
	}
	pageList(query?: string) {
		return this.pages.list(query);
	}

	inboxAdd(item: Parameters<Inbox["add"]>[0]) {
		return this.inbox.add(item);
	}
	inboxList(options?: { includeDone?: boolean }) {
		return this.inbox.list(options);
	}
	inboxResolveApproval(approvalId: string): void {
		this.inbox.resolveApproval(approvalId);
	}

	/** The user was active in some app now (for the catch-up's 4 hours away). */
	touch(now = Date.now()): number {
		const previous = Number(this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = 'last_activity'").toArray()[0]?.value ?? now);
		this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES ('last_activity', ?)", String(now));
		return previous;
	}

	// ─── Plan and usage ───────────────────────────────────────────────────────

	plan(): PlanStatus {
		return (this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = 'plan'").toArray()[0]?.value as PlanStatus | undefined) ?? "none";
	}
	planAllows(feature: Feature): boolean {
		return planAllows(this.plan(), feature);
	}
	/** One verified Stripe event's changes; grants and refunds are keyed, so replays change nothing. */
	applyBilling(changes: BillingChange[]): void {
		for (const change of changes) {
			if (change.type === "plan") {
				// Stripe redelivers and reorders events: only a change at least as new as the last one applies.
				const last = Number(this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = 'plan_at'").toArray()[0]?.value ?? -1);
				if (change.at < last) continue;
				this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES ('plan', ?), ('plan_at', ?)", change.status, String(change.at));
			}
			else if (change.type === "customer") this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES ('stripe_customer', ?)", change.id);
			else if (change.type === "grant") balance.grantCredits(this.#sql, change.cents, change.key, this.#journal);
			else if (change.type === "refund") {
				// What was refunded comes off at the rate it was bought; only the part not already taken back.
				const key = `refunded:${change.chargeId}`;
				const applied = Number(this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = ?", key).toArray()[0]?.value ?? 0);
				if (change.refundedTotal <= applied) continue;
				const cents = Math.floor(change.refundedTotal / 1.1) - Math.floor(applied / 1.1);
				this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES (?, ?)", key, String(change.refundedTotal));
				if (cents > 0) balance.revokeCredits(this.#sql, cents, `refund:${change.chargeId}:${change.refundedTotal}`, this.#journal);
			}
		}
	}
	recordUsage(deltas: UsageDelta[]): void {
		recordUsage(this.#sql, deltas);
	}
	usage(since?: number) {
		return usageSummary(this.#sql, since);
	}

	// ─── Country, payments and bank data ───────────────────────────────────────

	/** The account's country (ISO alpha-2), which decides whether payments and finance are offered. */
	country(): string | undefined {
		return this.#sql.exec<{ value: string }>("SELECT value FROM user_meta WHERE key = 'country'").toArray()[0]?.value;
	}
	setCountry(country: string): void {
		this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES ('country', ?)", country.toUpperCase().slice(0, 2));
	}

	setSpendLimit(botId: string, limit: { perPurchase: number; perMonth: number }): void {
		setLimit(this.#sql, botId, limit);
	}
	spendCheck(botId: string, amount: number) {
		return checkLimits(this.#sql, botId, amount);
	}
	/** Checks the bot's limits and holds the amount in one step (nothing awaits between): the purchase's record. */
	spendCommit(botId: string, purchase: Purchase, approvalId: string): { ok: true; id: string } | { ok: false; reason: string } {
		const limits = checkLimits(this.#sql, botId, purchase.amount);
		if (!limits.ok) return limits;
		return { ok: true, id: recordPurchase(this.#sql, botId, purchase, approvalId) };
	}
	/** A held purchase whose credential was refused: the amount is free again. */
	purchaseCancel(id: string): void {
		this.#sql.exec("DELETE FROM purchases WHERE id = ?", id);
	}
	purchaseIssued(botId: string, purchase: Purchase): void {
		this.inbox.add({ kind: "review", botId, title: `Bought ${purchase.item} from ${purchase.merchant}`, detail: `${purchase.amount / 100} ${purchase.currency}` });
	}

	#plaid(): PlaidClient {
		if (!this.env.PLAID_CLIENT_ID || !this.env.PLAID_SECRET) throw new Error("bank data is not set up");
		return new PlaidClient({ clientId: this.env.PLAID_CLIENT_ID, secret: this.env.PLAID_SECRET, apiUrl: this.env.PLAID_API_URL });
	}

	/** Links a bank: the month's fee is reserved first, so too little balance refuses it. */
	async linkBank(publicToken: string): Promise<BankAccount[] | "insufficient"> {
		if (!this.planAllows("bank")) return "insufficient";
		const result = await linkBank({
			plaid: this.#plaid(),
			publicToken,
			reserve: async (units) => {
				const reservation = await this.reserve("bank", units);
				return reservation === "insufficient" ? "insufficient" : { id: reservation.id };
			},
			settle: (reservationId, units) => this.settle(reservationId, units),
			store: async (itemId, accessToken, accounts) => {
				await this.credentials().modify(`plaid:${itemId}`, async () => ({ type: "api_key", key: accessToken }));
				this.#sql.exec(
					"INSERT OR REPLACE INTO bank_links (item_id, accounts, renews_at, unpaid_since) VALUES (?, ?, ?, NULL)",
					itemId,
					accounts,
					Date.now() + BANK_FEE_PERIOD_MS,
				);
			},
		});
		if (result !== "insufficient") await this.#alarmAt(this.#nextBankDue());
		return result;
	}

	/** When the next bank link renews, or an unpaid one's grace ends. */
	#nextBankDue(): number {
		const row = this.#sql
			.exec<{ due: number | null }>("SELECT MIN(CASE WHEN unpaid_since IS NULL THEN renews_at ELSE MIN(renews_at, unpaid_since + ?) END) AS due FROM bank_links", BANK_GRACE_MS)
			.one();
		return row.due ?? Number.MAX_SAFE_INTEGER;
	}

	/**
	 * Each bank link due pays its next month (one unit per account). One that cannot is marked unpaid and the owner told;
	 * after seven unpaid days it is removed at Plaid and here, so the fee stops. Relinking restores it.
	 */
	async renewBankLinks(now = Date.now()): Promise<void> {
		const due = this.#sql
			.exec<{ item_id: string; accounts: number; renews_at: number; unpaid_since: number | null }>("SELECT * FROM bank_links WHERE renews_at <= ?", now)
			.toArray();
		for (const link of due) {
			const reservation = await this.reserve("bank", link.accounts);
			if (reservation !== "insufficient") {
				await this.settle(reservation.id, link.accounts);
				this.#sql.exec("UPDATE bank_links SET renews_at = ?, unpaid_since = NULL WHERE item_id = ?", link.renews_at + BANK_FEE_PERIOD_MS, link.item_id);
				continue;
			}
			if (link.unpaid_since === null) {
				this.#sql.exec("UPDATE bank_links SET unpaid_since = ? WHERE item_id = ?", now, link.item_id);
				this.inbox.add({ kind: "review", botId: "account", title: "A bank link's monthly fee could not be paid", detail: "Top up within 7 days or the link is removed." });
				continue;
			}
			if (now - link.unpaid_since < BANK_GRACE_MS) continue;
			const credential = (await this.credentials().read(`plaid:${link.item_id}`)) as { key?: string } | undefined;
			if (credential?.key) await this.#plaid().removeItem(credential.key);
			await this.credentials().delete(`plaid:${link.item_id}`);
			this.#sql.exec("DELETE FROM bank_links WHERE item_id = ?", link.item_id);
			this.inbox.add({ kind: "review", botId: "account", title: "A bank link was removed", detail: "Its monthly fee went unpaid for 7 days. Link it again any time." });
		}
		if (this.#sql.exec("SELECT 1 FROM bank_links LIMIT 1").toArray().length > 0) await this.#alarmAt(Math.max(now + 60_000, this.#nextBankDue()));
	}

	/** Every linked bank account, read-only, across the account's Plaid items. */
	async bankAccounts(): Promise<BankAccount[]> {
		const items = (await this.credentials().list()).filter((item) => item.providerId.startsWith("plaid:"));
		const accounts: BankAccount[] = [];
		for (const item of items) {
			const credential = (await this.credentials().read(item.providerId)) as { key?: string } | undefined;
			if (credential?.key) accounts.push(...(await this.#plaid().accounts(credential.key)));
		}
		return accounts;
	}

	// ─── Computer workspaces ──────────────────────────────────────────────────
	// Sealed here with the account's data key, which never leaves this object: 64 KiB segments and a manifest, stored
	// in R2 under the save's generation, which is never overwritten.

	/** Seals and stores the workspace `source` as generation `generation`; resolves with its manifest once complete. */
	async saveWorkspace(generation: number, source: ReadableStream<Uint8Array>): Promise<ArchiveManifest> {
		const storageId = `workspace:${this.#accountId}`;
		const prefix = workspacePrefix(this.#accountId, generation);
		if (await this.env.FILES.head(`${prefix}manifest`)) throw new Error(`workspace generation ${generation} already exists`);
		const sealed = sealArchive(await this.#key(), streamChunks(source), { storageId, generation });
		let index = 0;
		for await (const segment of sealed.segments) await this.env.FILES.put(`${prefix}${String(index++).padStart(8, "0")}`, segment);
		const manifest = await sealed.manifest;
		// The manifest goes last: a generation without one never finished and is never read.
		await this.env.FILES.put(`${prefix}manifest`, JSON.stringify(manifest));
		return manifest;
	}

	/** The plaintext of a stored workspace generation; the stream errors on any missing, reordered or altered segment. */
	async openWorkspace(generation: number): Promise<ReadableStream<Uint8Array>> {
		const prefix = workspacePrefix(this.#accountId, generation);
		const stored = await this.env.FILES.get(`${prefix}manifest`);
		if (!stored) throw new Error(`no workspace generation ${generation}`);
		const manifest = JSON.parse(await stored.text()) as ArchiveManifest;
		const bucket = this.env.FILES;
		async function* segments(): AsyncIterable<Uint8Array> {
			for (let index = 0; ; index++) {
				const object = await bucket.get(`${prefix}${String(index).padStart(8, "0")}`);
				if (!object) return;
				yield new Uint8Array(await object.arrayBuffer());
			}
		}
		const plaintext = openArchive(await this.#key(), segments(), manifest)[Symbol.asyncIterator]();
		return new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					const next = await plaintext.next();
					if (next.done) controller.close();
					else controller.enqueue(next.value);
				} catch (error) {
					controller.error(error);
				}
			},
		});
	}
}
