// The file store (spec section 8): attachments, bots' outputs and knowledge files, each kept in R2 sealed with the
// user's data key and the file's id as AAD. The index lives in the user object.
import type { FileKind, FileRef } from "@knightcode/bots-protocol";
import { openBytes, sealBytes } from "../crypto/envelope.ts";

export interface FileMeta {
	name: string;
	kind: FileKind;
	botId?: string;
	mime?: string;
}

const MIME: Record<string, string> = {
	md: "text/markdown",
	txt: "text/plain",
	csv: "text/csv",
	json: "application/json",
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const aad = (id: string) => `file:${id}`;
const objectKey = (accountId: string, id: string) => `files/${accountId}/${id}`;

export function createFilesTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS files (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		size INTEGER NOT NULL,
		mime TEXT NOT NULL,
		kind TEXT NOT NULL,
		bot_id TEXT,
		created_at INTEGER NOT NULL
	)`);
	sql.exec("CREATE INDEX IF NOT EXISTS files_bot_kind ON files (bot_id, kind)");
}

type Row = { id: string; name: string; size: number; mime: string; kind: FileKind; bot_id: string | null; created_at: number };

const toRef = (row: Row): FileRef => ({
	id: row.id,
	name: row.name,
	size: row.size,
	mime: row.mime,
	kind: row.kind,
	...(row.bot_id ? { botId: row.bot_id } : {}),
	createdAt: row.created_at,
});

export async function putFile(
	sql: SqlStorage,
	bucket: R2Bucket,
	key: CryptoKey,
	accountId: string,
	meta: FileMeta,
	body: string | Uint8Array | ArrayBuffer,
): Promise<FileRef> {
	const bytes =
		typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(body);
	const id = `file_${crypto.randomUUID()}`;
	await bucket.put(objectKey(accountId, id), await sealBytes(key, bytes, aad(id)));
	const row: Row = {
		id,
		name: meta.name,
		size: bytes.length,
		mime: meta.mime ?? mimeOf(meta.name),
		kind: meta.kind,
		bot_id: meta.botId ?? null,
		created_at: Date.now(),
	};
	sql.exec(
		"INSERT INTO files (id, name, size, mime, kind, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		row.id,
		row.name,
		row.size,
		row.mime,
		row.kind,
		row.bot_id,
		row.created_at,
	);
	return toRef(row);
}

/** The file's reference and contents, or undefined when there is no such file. */
export async function getFile(
	sql: SqlStorage,
	bucket: R2Bucket,
	key: CryptoKey,
	accountId: string,
	id: string,
): Promise<{ ref: FileRef; body: Uint8Array } | undefined> {
	const row = sql.exec<Row>("SELECT * FROM files WHERE id = ?", id).toArray()[0];
	if (!row) return undefined;
	const object = await bucket.get(objectKey(accountId, id));
	if (!object) return undefined;
	return { ref: toRef(row), body: await openBytes(key, new Uint8Array(await object.arrayBuffer()), aad(id)) };
}

export function listFiles(sql: SqlStorage, filter: { botId?: string; kind?: FileKind }): FileRef[] {
	const where: string[] = [];
	const values: string[] = [];
	if (filter.botId) {
		where.push("bot_id = ?");
		values.push(filter.botId);
	}
	if (filter.kind) {
		where.push("kind = ?");
		values.push(filter.kind);
	}
	const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
	return sql.exec<Row>(`SELECT * FROM files${clause} ORDER BY created_at`, ...values).toArray().map(toRef);
}
