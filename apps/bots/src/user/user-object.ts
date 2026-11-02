// The user object (spec sections 4, 8, 16 and 21): one per account, named by the account id. It holds the vault, the
// model provider credentials, the balance and the file index, all sealed with the account's own data key (itself
// wrapped by the key-encryption key), so destroying that key makes the account's data unreadable at once.
import type { Credential, CredentialInfo, CredentialStore } from "@knightcode/ai";
import { builtinModels } from "@knightcode/ai/providers/all";
import type { FileKind, FileRef, VaultItem } from "@knightcode/bots-protocol";
import { DurableObject } from "cloudflare:workers";
import { createDataKey, unwrapDataKey } from "../crypto/envelope.ts";
import { type Env, getKek } from "../env.ts";
import * as balance from "./balance.ts";
import type { Balance, MeteredKind, Reservation } from "./balance.ts";
import { createCredentialsTable, SealedCredentialStore } from "./credentials.ts";
import { beginEnrollment, createEnrollmentTable, spendEnrollment } from "./enrollment.ts";
import { createFilesTable, type FileMeta, getFile, listFiles, putFile } from "./files.ts";
import { createOutboxTable, flushJournal, type JournalEntry, recordJournal } from "./journal.ts";
import { createVaultTable, type RevealPurpose, type VaultInput, vaultDelete, vaultList, vaultPut, vaultReveal } from "./vault.ts";

export class UserObject extends DurableObject<Env> {
	readonly #sql: SqlStorage;
	#dataKey: Promise<CryptoKey> | undefined;
	#credentials: SealedCredentialStore | undefined;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql = ctx.storage.sql;
		ctx.blockConcurrencyWhile(async () => {
			this.#sql.exec("CREATE TABLE IF NOT EXISTS data_key (id INTEGER PRIMARY KEY CHECK (id = 1), wrapped TEXT NOT NULL)");
			createVaultTable(this.#sql);
			createCredentialsTable(this.#sql);
			createEnrollmentTable(this.#sql);
			balance.createBalanceTables(this.#sql);
			createOutboxTable(this.#sql);
			createFilesTable(this.#sql);
		});
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

	async #flush(): Promise<void> {
		await flushJournal(this.#sql, this.env.DB, this.#accountId);
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
}
