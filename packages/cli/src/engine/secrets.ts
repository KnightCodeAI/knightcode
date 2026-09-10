/**
 * Secret storage for the engine.
 *
 * The platform keychain APIs store and retrieve one secret by name but cannot
 * enumerate what a service holds. `CredentialStore.list()` has to answer anyway,
 * so a separate index records which providers have a credential and of what
 * type. The index holds no secret material, which is also what lets
 * `GET /v1/accounts` answer without touching the keychain at all.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SecretBackend {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
}

export interface AccountIndexEntry {
	providerId: string;
	type: "api_key" | "oauth";
}

export interface AccountIndex {
	read(): Promise<readonly AccountIndexEntry[]>;
	write(entries: readonly AccountIndexEntry[]): Promise<void>;
}

function isIndexEntry(value: unknown): value is AccountIndexEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Partial<AccountIndexEntry>;
	return typeof entry.providerId === "string" && (entry.type === "api_key" || entry.type === "oauth");
}

export function createFileAccountIndex(path: string): AccountIndex {
	return {
		async read() {
			try {
				const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
				return Array.isArray(parsed) ? parsed.filter(isIndexEntry) : [];
			} catch {
				// Missing or corrupt index reads as empty; `list()` rebuilds it.
				return [];
			}
		},
		async write(entries) {
			mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
			writeFileSync(path, JSON.stringify(entries), { encoding: "utf-8", mode: 0o600 });
		},
	};
}

export function createMemoryAccountIndex(): AccountIndex {
	let entries: readonly AccountIndexEntry[] = [];
	return {
		async read() {
			return entries;
		},
		async write(next) {
			entries = [...next];
		},
	};
}

export function createMemorySecretBackend(): SecretBackend {
	const store = new Map<string, string>();
	return {
		async get(name) {
			return store.get(name) ?? null;
		},
		async set(name, value) {
			store.set(name, value);
		},
		async delete(name) {
			store.delete(name);
		},
	};
}
