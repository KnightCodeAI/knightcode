// The user object (spec sections 4, 8, 16 and 21): one per account, named by the account id. It holds the vault, the
// model provider credentials, the balance and the file index, all sealed with the account's own data key (itself
// wrapped by the key-encryption key), so destroying that key makes the account's data unreadable at once.
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
import { type BankAccount, linkBank, PlaidClient } from "../finance/plaid.ts";
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

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql = ctx.storage.sql;
		this.#desktop = new DesktopLink(ctx, env, () => this.#accountId);
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
		return this.#desktop.accept();
	}
	override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		await this.#desktop.message(socket, message);
	}
	override webSocketClose(socket: WebSocket, code: number): void {
		try {
			socket.close(code, "closed");
		} catch {
			// Already closed.
		}
		this.#desktop.closed();
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
		return vaultPut(this.#sql, await this.#key(), item);
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
		const models = builtinModels({ credentials: this.credentials() });
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
		await this.#flush();
		await this.flushPushes();
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
			if (change.type === "plan") this.#sql.exec("INSERT OR REPLACE INTO user_meta (key, value) VALUES ('plan', ?)", change.status);
			else if (change.type === "grant") balance.grantCredits(this.#sql, change.cents, change.key, this.#journal);
			else balance.revokeCredits(this.#sql, change.cents, change.key, this.#journal);
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
	recordPurchase(botId: string, purchase: Purchase, approvalId: string): string {
		const id = recordPurchase(this.#sql, botId, purchase, approvalId);
		this.inbox.add({ kind: "review", botId, title: `Bought ${purchase.item} from ${purchase.merchant}`, detail: `${purchase.amount / 100} ${purchase.currency}` });
		return id;
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
			reserve: async () => {
				const reservation = await this.reserve("bank", 1);
				return reservation === "insufficient" ? "insufficient" : { id: reservation.id };
			},
			settle: (reservationId) => this.settle(reservationId, 1),
			store: async (itemId, accessToken) => {
				await this.credentials().modify(`plaid:${itemId}`, async () => ({ type: "api_key", key: accessToken }));
			},
		});
		return result;
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
