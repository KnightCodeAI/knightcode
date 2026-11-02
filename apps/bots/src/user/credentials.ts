// Model provider credentials (spec section 4) as a CredentialStore for @knightcode/ai, sealed like vault values. The
// harness refreshes an expired OAuth token inside `modify`, re-checking expiry there; serializing `modify` per provider
// here is what makes two bots needing a refresh at once cause exactly one refresh.
import type { Credential, CredentialInfo, CredentialStore } from "@knightcode/ai";
import { open, seal } from "../crypto/envelope.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const aad = (provider: string) => `credential:${provider}`;

export function createCredentialsTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS credentials (
		provider TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		sealed TEXT NOT NULL,
		updated_at INTEGER NOT NULL
	)`);
}

/** A store over the user object's SQLite, sealed with `key()` (the user's data key). */
export class SealedCredentialStore implements CredentialStore {
	readonly #sql: SqlStorage;
	readonly #key: () => Promise<CryptoKey>;
	/** One in-flight write per provider; the next waits for it, including while it awaits a token endpoint. */
	readonly #chains = new Map<string, Promise<unknown>>();

	constructor(sql: SqlStorage, key: () => Promise<CryptoKey>) {
		this.#sql = sql;
		this.#key = key;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		const row = this.#sql.exec<{ sealed: string }>("SELECT sealed FROM credentials WHERE provider = ?", providerId).toArray()[0];
		if (!row) return undefined;
		return JSON.parse(decoder.decode(await open(await this.#key(), row.sealed, aad(providerId)))) as Credential;
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return this.#sql
			.exec<{ provider: string; type: Credential["type"] }>("SELECT provider, type FROM credentials ORDER BY provider")
			.toArray()
			.map((row) => ({ providerId: row.provider, type: row.type }));
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
	): Promise<Credential | undefined> {
		return this.#serialize(providerId, async () => {
			const current = await this.read(providerId);
			const next = await fn(current);
			if (next === undefined) return current;
			const sealed = await seal(await this.#key(), encoder.encode(JSON.stringify(next)), aad(providerId));
			this.#sql.exec(
				"INSERT INTO credentials (provider, type, sealed, updated_at) VALUES (?, ?, ?, ?) " +
					"ON CONFLICT (provider) DO UPDATE SET type = excluded.type, sealed = excluded.sealed, updated_at = excluded.updated_at",
				providerId,
				next.type,
				sealed,
				Date.now(),
			);
			return next;
		});
	}

	delete(providerId: string): Promise<void> {
		return this.#serialize(providerId, async () => {
			this.#sql.exec("DELETE FROM credentials WHERE provider = ?", providerId);
		});
	}

	#serialize<T>(providerId: string, task: () => Promise<T>): Promise<T> {
		const previous = this.#chains.get(providerId) ?? Promise.resolve();
		const run = previous.then(task, task);
		const tail = run.catch(() => undefined);
		this.#chains.set(providerId, tail);
		void tail.then(() => {
			if (this.#chains.get(providerId) === tail) this.#chains.delete(providerId);
		});
		return run;
	}
}
