/** A cache of what a listing needs per session file (§5.10). Never the source of truth. */

import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import { buildSessionInfo, mapWithConcurrency } from "../core/session-manager.ts";
import { titleOf } from "./loaded-thread.ts";
import { parentIdOf } from "./session-files.ts";

const INDEX_FILE = ".thread-index.json";
const VERSION = 1;
const CONCURRENCY = 64;
export const MAX_INDEX_BYTES = 16 * 1024 * 1024;
/** titleOf cuts to 200 code points and adds an ellipsis. */
const MAX_TITLE_CODE_POINTS = 201;

export interface IndexedSession {
	path: string;
	id: string;
	cwd: string;
	/** The display title, already bounded (titleOf): never the first message itself. */
	title: string;
	/** The parent's header id, resolved when this file was scanned. */
	forkedFromId?: string;
	created: Date;
	modified: Date;
	messageCount: number;
}

const strict = { additionalProperties: false } as const;
const StoredSession = Type.Object(
	{
		id: Type.String({ maxLength: 128 }),
		cwd: Type.String({ maxLength: 4096 }),
		title: Type.String({ maxLength: 4 * MAX_TITLE_CODE_POINTS }),
		forkedFromId: Type.Optional(Type.String({ maxLength: 128 })),
		created: Type.String({ maxLength: 64 }),
		modified: Type.String({ maxLength: 64 }),
		messageCount: Type.Integer({ minimum: 0 }),
	},
	strict,
);
const Entry = Type.Object(
	{
		size: Type.Integer({ minimum: 0 }),
		mtimeMs: Type.Number(),
		/** null: a .jsonl that is not a session, remembered so it is not re-read every listing. */
		session: Type.Union([StoredSession, Type.Null()]),
	},
	strict,
);
const isEntry = Compile(Entry);
type StoredSession = Static<typeof StoredSession>;
type Entry = Static<typeof Entry>;
export type ReadKind = "transcript" | "parentHeader";

async function readIndex(dir: string): Promise<Record<string, unknown>> {
	try {
		const path = join(dir, INDEX_FILE);
		if ((await stat(path)).size > MAX_INDEX_BYTES) return {}; // refuse unread: a cache that large is not trusted
		const parsed = JSON.parse(await readFile(path, "utf8")) as { version?: unknown; entries?: unknown };
		return parsed.version === VERSION &&
			typeof parsed.entries === "object" &&
			parsed.entries !== null &&
			!Array.isArray(parsed.entries)
			? (parsed.entries as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** A stored entry, only if every field is well formed; otherwise undefined and the file is rescanned. */
function validEntry(value: unknown): Entry | undefined {
	if (!isEntry.Check(value)) return undefined;
	const entry = value as Entry;
	const session = entry.session;
	if (session) {
		if (Number.isNaN(Date.parse(session.created)) || Number.isNaN(Date.parse(session.modified))) return undefined;
		if ([...session.title].length > MAX_TITLE_CODE_POINTS) return undefined;
	}
	return entry;
}

/** Built from the named fields only, so nothing else in the file reaches memory. */
const revive = (path: string, s: StoredSession): IndexedSession => ({
	path,
	id: s.id,
	cwd: s.cwd,
	title: s.title,
	...(s.forkedFromId !== undefined ? { forkedFromId: s.forkedFromId } : {}),
	created: new Date(s.created),
	modified: new Date(s.modified),
	messageCount: s.messageCount,
});

/** Best effort: the listing is already computed; a cache that cannot be written only costs a rescan next time. */
async function writeIndex(dir: string, entries: Record<string, Entry>): Promise<void> {
	const temp = join(dir, `${INDEX_FILE}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temp, JSON.stringify({ version: VERSION, entries }));
		await rename(temp, join(dir, INDEX_FILE)); // atomic: readers see the old index or the new one
	} catch {
		await rm(temp, { force: true }).catch(() => {});
	}
}

export async function listWithIndex(
	dir: string,
	options: { onRead?: (path: string, kind: ReadKind, bytes: number) => void } = {},
): Promise<IndexedSession[]> {
	const previous = await readIndex(dir);
	const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".jsonl"));
	const next: Record<string, Entry> = {};
	let changed = Object.keys(previous).length !== names.length;
	const results = await mapWithConcurrency(names, CONCURRENCY, async (name): Promise<IndexedSession | undefined> => {
		const path = join(dir, name);
		const stats = await stat(path).catch(() => undefined);
		if (!stats?.isFile()) return undefined;
		const cached = validEntry(previous[name]);
		if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
			next[name] = cached;
			return cached.session ? revive(path, cached.session) : undefined;
		}
		changed = true;
		options.onRead?.(path, "transcript", stats.size);
		const info = await buildSessionInfo(path, undefined, stats).catch(() => null);
		// Check the fresh Date objects BEFORE toISOString(), which throws on an invalid date.
		if (!info || !Number.isFinite(info.created.getTime()) || !Number.isFinite(info.modified.getTime())) {
			next[name] = { size: stats.size, mtimeMs: stats.mtimeMs, session: null };
			return undefined;
		}
		const forkedFromId = parentIdOf(info.parentSessionPath, (parent) => options.onRead?.(parent, "parentHeader", 0));
		const session: StoredSession = {
			id: info.id,
			cwd: info.cwd,
			title: titleOf(info.name, info.firstMessage),
			...(forkedFromId !== undefined ? { forkedFromId } : {}),
			created: info.created.toISOString(),
			modified: info.modified.toISOString(),
			messageCount: info.messageCount,
		};
		const scanned = validEntry({ size: stats.size, mtimeMs: stats.mtimeMs, session });
		if (!scanned) {
			next[name] = { size: stats.size, mtimeMs: stats.mtimeMs, session: null };
			return undefined;
		}
		next[name] = scanned;
		return revive(path, session);
	});
	if (changed) await writeIndex(dir, next);
	return results.filter((s): s is IndexedSession => s !== undefined);
}
