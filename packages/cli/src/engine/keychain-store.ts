/**
 * CredentialStore backed by the OS keychain.
 *
 * `Models.getAuth()` runs OAuth refresh inside `modify`, so writes for one
 * provider must serialize: two concurrent requests that both refresh a rotated
 * token would lose one of them. Writes for different providers are independent
 * and run concurrently.
 */

import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@knightcode/ai";
import { AuthStorage } from "../core/auth-storage.ts";
import { type AccountIndex, type AccountIndexEntry, createFileAccountIndex, type SecretBackend } from "./secrets.ts";

export interface KeychainCredentialStoreOptions {
	backend: SecretBackend;
	index: AccountIndex;
}

function secretName(providerId: string): string {
	return `provider:${providerId}`;
}

export class KeychainCredentialStore implements CredentialStore {
	private readonly backend: SecretBackend;
	private readonly index: AccountIndex;
	private readonly operations = new Map<string, Promise<unknown>>();
	private indexOperation: Promise<unknown> = Promise.resolve();

	constructor(options: KeychainCredentialStoreOptions) {
		this.backend = options.backend;
		this.index = options.index;
	}

	/** Serialize every write for one provider id onto a single chain. */
	private enqueue<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.operations.get(providerId) ?? Promise.resolve();
		const next = previous.then(fn, fn);
		// Park a swallowed copy as the tail so one rejection does not poison the
		// chain for later writes; the rejection itself still reaches the caller.
		this.operations.set(
			providerId,
			next.catch(() => undefined),
		);
		return next;
	}

	/**
	 * The per-provider chains run concurrently, but they all read-modify-write
	 * one shared index. Without a second lock covering just that, two providers
	 * written at the same time read the same snapshot and the later write drops
	 * the earlier provider's entry — a credential that exists in the keychain but
	 * is missing from list() and /v1/accounts.
	 *
	 * This lock covers only the index, which is local and fast, so a slow OAuth
	 * refresh for one provider still does not block a write for another.
	 */
	private withIndex<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.indexOperation.then(fn, fn);
		this.indexOperation = next.catch(() => undefined);
		return next;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		const raw = await this.backend.get(secretName(providerId));
		if (raw === null) return undefined;
		try {
			return JSON.parse(raw) as Credential;
		} catch {
			// A corrupt entry is indistinguishable from no entry to every caller.
			return undefined;
		}
	}

	list(): Promise<readonly CredentialInfo[]> {
		return this.withIndex(async () => {
			const entries = await this.index.read();
			const present: AccountIndexEntry[] = [];
			for (const entry of entries) {
				const credential = await this.read(entry.providerId);
				if (credential) present.push({ providerId: entry.providerId, type: credential.type });
			}
			// A crash between the two writes can leave an entry with no secret. Heal
			// the index rather than reporting an account the user cannot use.
			if (present.length !== entries.length) await this.index.write(present);
			return present.map((entry) => ({ providerId: entry.providerId, type: entry.type }));
		});
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		return this.enqueue(providerId, async () => {
			const current = await this.read(providerId);
			const next = await fn(current);
			if (next === undefined) return current;
			await this.backend.set(secretName(providerId), JSON.stringify(next));
			await this.withIndex(async () => {
				const entries = (await this.index.read()).filter((entry) => entry.providerId !== providerId);
				await this.index.write([...entries, { providerId, type: next.type }]);
			});
			return next;
		});
	}

	delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
		return this.enqueue(providerId, async () => {
			// Index first: an orphaned secret is invisible, an orphaned index
			// entry advertises an account that cannot be used.
			await this.withIndex(async () => {
				const entries = (await this.index.read()).filter((entry) => entry.providerId !== providerId);
				await this.index.write(entries);
			});
			await this.backend.delete(secretName(providerId));
		});
	}
}

export interface CreateEngineCredentialStoreOptions {
	backend?: SecretBackend;
	index?: AccountIndex;
	indexPath?: string;
	fallbackAuthPath?: string;
}

export function createEngineCredentialStore(options: CreateEngineCredentialStoreOptions): CredentialStore {
	if (!options.backend) {
		// No keychain on this machine. Fall back to the CLI's file store, which
		// already writes at 0600 and holds a cross-process lock. The caller
		// reports the fallback: silently degrading a secret store is not
		// acceptable, and refusing to run without a keyring is not either.
		return AuthStorage.create(options.fallbackAuthPath);
	}
	const index = options.index ?? createFileAccountIndex(options.indexPath ?? "engine-accounts.json");
	return new KeychainCredentialStore({ backend: options.backend, index });
}
