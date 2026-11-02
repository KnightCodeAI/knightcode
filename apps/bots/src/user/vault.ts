// The vault (spec section 21): API credentials, website logins and command variables. Values are sealed with the user's
// data key and the item's id as AAD; the API returns metadata only. Reading a value back is for server-side tool code
// (injecting a credential, filling a login), never for a client route.
import type { VaultItem } from "@knightcode/bots-protocol";
import { open, seal } from "../crypto/envelope.ts";

export type VaultInput = Omit<VaultItem, "id" | "createdAt"> & { value: string };

/** What a revealed value may be used for; recorded so every reveal is accounted for. */
export type RevealPurpose = "inject" | "fill";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const aad = (id: string) => `vault:${id}`;

export function createVaultTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS vault (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		name TEXT NOT NULL,
		origin TEXT,
		injection TEXT,
		header TEXT,
		sealed TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`);
	sql.exec(`CREATE TABLE IF NOT EXISTS vault_reveals (id TEXT NOT NULL, purpose TEXT NOT NULL, at INTEGER NOT NULL)`);
}

type Row = { id: string; kind: string; name: string; origin: string | null; injection: string | null; header: string | null; created_at: number };

const toItem = (row: Row): VaultItem => ({
	id: row.id,
	kind: row.kind as VaultItem["kind"],
	name: row.name,
	...(row.origin ? { origin: row.origin } : {}),
	...(row.injection ? { injection: row.injection as NonNullable<VaultItem["injection"]> } : {}),
	...(row.header ? { header: row.header } : {}),
	createdAt: row.created_at,
});

export async function vaultPut(sql: SqlStorage, key: CryptoKey, input: VaultInput): Promise<VaultItem> {
	if (input.kind !== "env" && !/^https:\/\//.test(input.origin ?? "")) throw new Error("a credential needs an https origin");
	const id = `vault_${crypto.randomUUID()}`;
	const sealed = await seal(key, encoder.encode(input.value), aad(id));
	const createdAt = Date.now();
	sql.exec(
		"INSERT INTO vault (id, kind, name, origin, injection, header, sealed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		id,
		input.kind,
		input.name,
		input.origin ?? null,
		input.kind === "api" ? (input.injection ?? "bearer") : null,
		input.kind === "api" && input.injection === "header" ? (input.header ?? null) : null,
		sealed,
		createdAt,
	);
	return toItem(sql.exec<Row>("SELECT id, kind, name, origin, injection, header, created_at FROM vault WHERE id = ?", id).one());
}

/** Every item's metadata, newest first. No value ever leaves through here. */
export function vaultList(sql: SqlStorage): VaultItem[] {
	return sql
		.exec<Row>("SELECT id, kind, name, origin, injection, header, created_at FROM vault ORDER BY created_at DESC")
		.toArray()
		.map(toItem);
}

export function vaultDelete(sql: SqlStorage, id: string): void {
	sql.exec("DELETE FROM vault WHERE id = ?", id);
}

/** The value, for server-side tool code only; each reveal is recorded with its purpose. */
export async function vaultReveal(sql: SqlStorage, key: CryptoKey, id: string, purpose: RevealPurpose): Promise<string> {
	const row = sql.exec<{ sealed: string }>("SELECT sealed FROM vault WHERE id = ?", id).toArray()[0];
	if (!row) throw new Error("no such vault item");
	sql.exec("INSERT INTO vault_reveals (id, purpose, at) VALUES (?, ?, ?)", id, purpose, Date.now());
	return decoder.decode(await open(key, row.sealed, aad(id)));
}
