/** Bounded, expiring immutable listing scans. Continuations perform no transcript I/O. */
import { randomUUID } from "node:crypto";
import type { ParamsOf, ResultOf, ThreadSummary } from "@knightcode/app-server-protocol";
import { resolvePath } from "../utils/paths.ts";
import { AppServerError } from "./errors.ts";
import { HISTORY_ENVELOPE_RESERVE_BYTES, MAX_HISTORY_RESPONSE_BYTES } from "./history-pages.ts";

const MAX_SNAPSHOTS = 32;
const EXPIRY_MS = 5 * 60_000;
const PAGE_SIZE = 50;
interface Snapshot {
	filter: string;
	threads: ThreadSummary[];
	expires: number;
}
interface Cursor {
	id: string;
	next: number;
	filter: string;
}
const invalid = () =>
	new AppServerError("invalidCursor", "Listing cursor expired, was evicted, or its filters changed; list again");

export class ListingPages {
	private readonly snapshots = new Map<string, Snapshot>();
	private closed = false;
	clear(): void {
		this.closed = true;
		this.snapshots.clear();
	}

	async page(params: ParamsOf<"thread/list">, scan: () => Promise<ThreadSummary[]>): Promise<ResultOf<"thread/list">> {
		if (this.closed) throw new AppServerError("shuttingDown", "the listing service is shutting down");
		for (const [id, snapshot] of this.snapshots) if (snapshot.expires <= Date.now()) this.snapshots.delete(id);
		const filter = JSON.stringify([
			params.cwd === undefined ? null : resolvePath(params.cwd),
			params.archived === true,
		]);
		let id: string;
		let next = 0;
		let snapshot: Snapshot;
		if (params.cursor !== undefined) {
			if (Buffer.byteLength(params.cursor) > 4096 || !/^[A-Za-z0-9_-]+$/.test(params.cursor)) throw invalid();
			let decoded: unknown;
			try {
				decoded = JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8"));
			} catch {
				throw invalid();
			}
			if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw invalid();
			const cursor = decoded as Partial<Cursor>;
			if (
				typeof cursor.id !== "string" ||
				cursor.filter !== filter ||
				!Number.isSafeInteger(cursor.next) ||
				cursor.next! < 1
			)
				throw invalid();
			id = cursor.id;
			next = cursor.next!;
			const found = this.snapshots.get(id);
			if (!found || found.filter !== filter || next >= found.threads.length) throw invalid();
			snapshot = found;
			this.snapshots.delete(id);
		} else {
			id = randomUUID();
			snapshot = { filter, threads: (await scan()).map((thread) => ({ ...thread })), expires: 0 };
		}
		if (this.closed) throw new AppServerError("shuttingDown", "the listing service is shutting down");
		snapshot.expires = Date.now() + EXPIRY_MS;
		this.snapshots.set(id, snapshot);
		while (this.snapshots.size > MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!);
		const page: ResultOf<"thread/list"> = { threads: [] };
		for (let i = next; i < snapshot.threads.length && page.threads.length < PAGE_SIZE; i++) {
			const candidate: ResultOf<"thread/list"> = { threads: [...page.threads, { ...snapshot.threads[i] }] };
			if (i + 1 < snapshot.threads.length)
				candidate.nextCursor = Buffer.from(JSON.stringify({ id, next: i + 1, filter })).toString("base64url");
			if (Buffer.byteLength(JSON.stringify(candidate)) + HISTORY_ENVELOPE_RESERVE_BYTES > MAX_HISTORY_RESPONSE_BYTES) {
				if (page.threads.length === 0)
					throw new AppServerError("internal", "Thread summary exceeds the listing response limit");
				break;
			}
			page.threads = candidate.threads;
			page.nextCursor = candidate.nextCursor;
		}
		return page;
	}
}
