/** Immutable wire payloads. Large JSON is captured as segments, never as one intermediate string or buffer. */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
	Item,
	ParamsOf,
	PayloadRef,
	ResultOf,
	ToolOutput,
	Turn,
	TurnSummary,
	WireItem,
	WireTurn,
} from "@knightcode/app-server-protocol";
import { AppServerError } from "./errors.ts";

export const INLINE_PAYLOAD_BYTES = 65_536;
export const PAYLOAD_CHUNK_BYTES = 49_152;
export const PAYLOAD_LEASE_MS = 30 * 60_000;
const STRING_CHUNK_UNITS = 8192;

type Segment =
	| { kind: "string"; value: string }
	| { kind: "literal"; value: string }
	| { kind: "array"; children: Segment[] }
	| { kind: "object"; children: Array<[string, Segment]> };

/** Copies the shape synchronously; strings are immutable and can be shared until their spool finishes. */
function capture(value: unknown, ancestors = new Set<object>()): Segment {
	if (typeof value === "string") return { kind: "string", value };
	if (value === null || value === undefined || typeof value === "function" || typeof value === "symbol")
		return { kind: "literal", value: "null" };
	if (typeof value === "number" || typeof value === "boolean") return { kind: "literal", value: JSON.stringify(value) };
	if (typeof value !== "object") throw new AppServerError("internal", "Payload is not JSON serializable");
	if (ancestors.has(value)) throw new AppServerError("internal", "Payload contains a cyclic value");
	ancestors.add(value);
	try {
		if (Array.isArray(value))
			return { kind: "array", children: value.map((item: unknown) => capture(item, ancestors)) };
		const children: Array<[string, Segment]> = [];
		for (const [key, item] of Object.entries(value)) {
			if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
			children.push([key, capture(item, ancestors)]);
		}
		return { kind: "object", children };
	} finally {
		ancestors.delete(value);
	}
}

function* jsonSegments(segment: Segment): Generator<string> {
	if (segment.kind === "literal") yield segment.value;
	else if (segment.kind === "string") {
		yield '"';
		for (let offset = 0; offset < segment.value.length;) {
			let end = Math.min(offset + STRING_CHUNK_UNITS, segment.value.length);
			// Do not manufacture lone-surrogate escapes by cutting a valid surrogate pair.
			const last = segment.value.charCodeAt(end - 1);
			if (end < segment.value.length && last >= 0xd800 && last <= 0xdbff) end--;
			yield JSON.stringify(segment.value.slice(offset, end)).slice(1, -1);
			offset = end;
		}
		yield '"';
	} else if (segment.kind === "array") {
		yield "[";
		for (let i = 0; i < segment.children.length; i++) {
			if (i > 0) yield ",";
			yield* jsonSegments(segment.children[i]);
		}
		yield "]";
	} else {
		yield "{";
		for (let i = 0; i < segment.children.length; i++) {
			if (i > 0) yield ",";
			const [key, child] = segment.children[i];
			yield* jsonSegments({ kind: "string", value: key });
			yield ":";
			yield* jsonSegments(child);
		}
		yield "}";
	}
}

function preview(text: string, limit: number): string {
	let result = "";
	let count = 0;
	for (const point of text) {
		if (count++ === limit) break;
		result += point;
	}
	return result;
}

interface Payload {
	file: string;
	bytes: number;
	expires: number;
	ready: Promise<void>;
	error?: string;
	readers: number;
	timer?: ReturnType<typeof setTimeout>;
}

export class PayloadStore {
	private readonly directory: string;
	private readonly records = new Map<string, Payload>();
	private readonly reads = new Set<Promise<unknown>>();
	private readonly removals = new Set<Promise<unknown>>();
	private readonly orphanCleanup: Promise<void>;
	private closing = false;
	private closePromise?: Promise<void>;

	constructor(agentDir: string) {
		const root = join(agentDir, "app-server-payloads");
		mkdirSync(root, { recursive: true, mode: 0o700 });
		this.directory = join(root, `${process.pid}-${randomUUID()}`);
		mkdirSync(this.directory, { mode: 0o700 });
		this.orphanCleanup = this.cleanOrphans(root);
	}

	private async cleanOrphans(root: string): Promise<void> {
		for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
			if (!entry.isDirectory() || !/^\d+-[a-f0-9-]{36}$/.test(entry.name)) continue;
			const pid = Number(entry.name.split("-", 1)[0]);
			if (!Number.isSafeInteger(pid) || pid <= 0) continue;
			try {
				process.kill(pid, 0);
			} catch (error) {
				// EPERM means alive but inaccessible. Only ESRCH confirms that the owner exited.
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
				const path = join(root, entry.name);
				const info = await lstat(path).catch(() => undefined);
				if (info?.isDirectory() && !info.isSymbolicLink())
					await rm(path, { recursive: true, force: true }).catch(() => {});
			}
		}
	}

	summary(turn: Turn): TurnSummary {
		return {
			id: turn.id,
			threadId: turn.threadId,
			status: turn.status,
			startedAt: turn.startedAt,
			...(turn.completedAt === undefined ? {} : { completedAt: turn.completedAt }),
			...(turn.error === undefined ? {} : { error: { ...turn.error, message: preview(turn.error.message, 2000) } }),
		};
	}

	item(item: Item): WireItem {
		const result = this.serialize(item);
		return result.ref
			? { type: "itemReference", id: item.id, itemType: item.type, payload: result.ref }
			: (result.inline as Item);
	}

	turn(turn: Turn): WireTurn {
		const result = this.serialize(turn);
		return result.ref ? { ...this.summary(turn), payload: result.ref } : (result.inline as Turn);
	}

	output(output: ToolOutput[]): ToolOutput[] | PayloadRef {
		const result = this.serialize(output);
		return result.ref ?? (result.inline as ToolOutput[]);
	}

	input(input: unknown): { input: unknown } | { inputRef: PayloadRef } {
		const result = this.serialize(input);
		return result.ref ? { inputRef: result.ref } : { input: result.inline };
	}

	/** Drop a reference that was never handed to a client. */
	release(ref: PayloadRef): void {
		const payload = this.records.get(ref.id);
		if (payload) this.remove(ref.id, payload);
	}

	private assertOpen(): void {
		if (this.closing) throw new AppServerError("shuttingDown", "the payload store is shutting down");
	}

	private serialize(value: unknown): { inline?: unknown; ref?: PayloadRef } {
		this.assertOpen();
		const snapshot = capture(value);
		const small: string[] = [];
		let bytes = 0;
		for (const chunk of jsonSegments(snapshot)) {
			bytes += Buffer.byteLength(chunk, "utf8");
			if (bytes <= INLINE_PAYLOAD_BYTES) small.push(chunk);
		}
		if (bytes <= INLINE_PAYLOAD_BYTES) return { inline: JSON.parse(small.join("")) as unknown };
		const id = randomUUID();
		const payload: Payload = {
			file: join(this.directory, id),
			bytes,
			expires: Date.now() + PAYLOAD_LEASE_MS,
			readers: 0,
			ready: Promise.resolve(),
		};
		this.records.set(id, payload);
		payload.ready = this.spool(payload.file, snapshot).catch((error: unknown) => {
			payload.error = preview(error instanceof Error ? error.message : String(error), 2000);
		});
		this.renew(id, payload);
		return { ref: { id, byteLength: bytes } };
	}

	private async spool(file: string, snapshot: Segment): Promise<void> {
		const handle = await open(file, "wx", 0o600);
		try {
			// Batch small punctuation segments, bounded independently of the payload's total size.
			let pieces: string[] = [];
			let units = 0;
			const flush = async () => {
				const buffer = Buffer.from(pieces.join(""), "utf8");
				pieces = [];
				units = 0;
				for (let written = 0; written < buffer.length;) {
					const result = await handle.write(buffer, written, buffer.length - written);
					if (result.bytesWritten === 0) throw new Error("payload write made no progress");
					written += result.bytesWritten;
				}
			};
			for (const chunk of jsonSegments(snapshot)) {
				pieces.push(chunk);
				units += chunk.length;
				if (units >= STRING_CHUNK_UNITS) await flush();
			}
			if (pieces.length) await flush();
		} finally {
			await handle.close();
		}
	}

	private renew(id: string, payload: Payload): void {
		payload.expires = Date.now() + PAYLOAD_LEASE_MS;
		clearTimeout(payload.timer);
		payload.timer = setTimeout(() => {
			if (payload.readers > 0) return this.renew(id, payload);
			this.remove(id, payload);
		}, PAYLOAD_LEASE_MS);
		payload.timer.unref?.();
	}

	private remove(id: string, payload: Payload): void {
		if (!this.records.delete(id)) return;
		clearTimeout(payload.timer);
		const work = payload.ready.then(() => rm(payload.file, { force: true })).catch(() => {});
		this.removals.add(work);
		void work.finally(() => this.removals.delete(work));
	}

	read(params: ParamsOf<"payload/read">): Promise<ResultOf<"payload/read">> {
		if (this.closing) return Promise.reject(new AppServerError("shuttingDown", "the payload store is shutting down"));
		const work = this.readAccepted(params);
		this.reads.add(work);
		const done = () => this.reads.delete(work);
		void work.then(done, done);
		return work;
	}

	private async readAccepted({
		id,
		offset,
		maxBytes = PAYLOAD_CHUNK_BYTES,
	}: ParamsOf<"payload/read">): Promise<ResultOf<"payload/read">> {
		const payload = this.records.get(id);
		if (!payload || payload.expires <= Date.now()) {
			if (payload && payload.readers === 0) this.remove(id, payload);
			throw new AppServerError(
				"payloadNotFound",
				"Payload is unknown or expired; read the thread again for a fresh reference",
			);
		}
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset > payload.bytes ||
			!Number.isSafeInteger(maxBytes) ||
			maxBytes < 1 ||
			maxBytes > PAYLOAD_CHUNK_BYTES
		)
			throw new AppServerError("invalidParams", "Invalid payload offset or chunk size");
		payload.readers++;
		this.renew(id, payload);
		try {
			await payload.ready;
			if (payload.error)
				throw new AppServerError(
					"internal",
					`Cannot spool payload: ${payload.error}. Check disk space and read the thread again.`,
				);
			const handle = await open(payload.file, "r");
			try {
				const buffer = Buffer.alloc(Math.min(maxBytes, payload.bytes - offset));
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
				const next = offset + bytesRead;
				if (bytesRead === 0 && next < payload.bytes)
					throw new AppServerError("internal", "Payload file was truncated; read the thread again");
				return {
					data: buffer.subarray(0, bytesRead).toString("base64"),
					eof: next === payload.bytes,
					...(next === payload.bytes ? {} : { nextOffset: next }),
				};
			} finally {
				await handle.close();
			}
		} finally {
			payload.readers--;
		}
	}

	getStats(): { payloads: number; bytes: number; reading: number } {
		let bytes = 0;
		for (const payload of this.records.values()) bytes += payload.bytes;
		return { payloads: this.records.size, bytes, reading: this.reads.size };
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closing = true;
		this.closePromise = (async () => {
			for (const payload of this.records.values()) clearTimeout(payload.timer);
			await Promise.allSettled([
				...this.reads,
				...this.removals,
				...[...this.records.values()].map((payload) => payload.ready),
			]);
			await this.orphanCleanup;
			await rm(this.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
			this.records.clear();
		})();
		return this.closePromise;
	}
}
