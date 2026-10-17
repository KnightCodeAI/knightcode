/** `file/search` (§4.4): fuzzy file names for `@` mentions, over the same listing the `find` tool uses (fd). */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ParamsOf, ResultOf } from "@knightcode/app-server-protocol";
import { ensureTool } from "../utils/tools-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import { AppServerError } from "./errors.ts";

const LISTING_TTL_MS = 10_000;
const MAX_CACHED_CWDS = 8;
const MAX_ACTIVE_LISTINGS = 2;
const MAX_FILES = 200_000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const LISTING_TIMEOUT_MS = 15_000;
const STDERR_TAIL_BYTES = 4096;

/** `truncated`: the list may be incomplete. `cacheable`: serving it again within the TTL is correct. */
export type Listing = { files: string[]; truncated: boolean; cacheable: boolean };
export type ListFiles = (cwd: string, signal: AbortSignal) => Promise<Listing>;

export function fuzzyScore(query: string, path: string): { score: number; indices: number[] } | undefined {
	const q = query.toLowerCase();
	const p = path.toLowerCase();
	const base = p.lastIndexOf("/") + 1;
	const indices: number[] = [];
	let score = 0;
	let from = 0;
	for (const char of q) {
		const at = p.indexOf(char, from);
		if (at === -1) return undefined;
		const previous = indices.at(-1);
		score += previous !== undefined && at === previous + 1 ? 5 : 1;
		if (at >= base) score += 2;
		if (at === 0 || "/._-".includes(p[at - 1])) score += 3;
		indices.push(at);
		from = at + 1;
	}
	return { score: score - path.length / 100, indices };
}

function insideGitRepo(dir: string): boolean {
	for (let current = dir; ; current = dirname(current)) {
		if (existsSync(join(current, ".git"))) return true;
		if (dirname(current) === current) return false;
	}
}

/**
 * Lists files with fd, gitignore-aware as the `find` tool runs it (`core/tools/find.ts:182-197`). `command` and
 * `args` replace the fd binary (tests run a stand-in); byte and path limits bound retained output.
 */
export function createFdLister(
	options: { command?: string; args?: string[]; maxStdoutBytes?: number; maxFiles?: number } = {},
): ListFiles {
	const maxBytes = options.maxStdoutBytes ?? MAX_STDOUT_BYTES;
	const maxFiles = options.maxFiles ?? MAX_FILES;
	return async (cwd, signal) => {
		const command = options.command ?? (await ensureTool("fd"));
		if (!command) throw new AppServerError("toolMissing", "fd is not available");
		const fdArgs = [
			"--type",
			"f",
			"--color=never",
			"--hidden",
			"--exclude",
			".git",
			"--max-results",
			String(maxFiles + 1),
		];
		if (!insideGitRepo(cwd)) fdArgs.push("--no-require-git");
		return new Promise<Listing>((resolve, reject) => {
			const child = spawn(command, [...(options.args ?? []), ...fdArgs], {
				cwd,
				signal,
				timeout: LISTING_TIMEOUT_MS,
				windowsHide: true,
			});
			const chunks: Buffer[] = [];
			let bytes = 0;
			let capped = false;
			let err = "";
			child.stdout.on("data", (chunk: Buffer) => {
				if (capped) return;
				const room = maxBytes - bytes;
				chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
				bytes += Math.min(chunk.length, room);
				if (chunk.length >= room) {
					capped = true;
					child.kill(); // stop fd: everything kept so far is within the cap
				}
			});
			child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err = (err + chunk).slice(-STDERR_TAIL_BYTES)));
			// spawn reports an abort as its own AbortError; the caller should see the abort's reason.
			child.on("error", (error) => reject(signal.aborted ? signal.reason : error));
			child.on("close", (code, killedBy) => {
				if (signal.aborted) return reject(signal.reason);
				const text = Buffer.concat(chunks).toString("utf8");
				// Only complete lines: a cut at the byte cap or a crash can leave half a path at the end.
				const listed = text
					.slice(0, text.lastIndexOf("\n") + 1)
					.split("\n")
					.filter(Boolean)
					.map((line) => line.replaceAll("\\", "/"));
				const countCapped = listed.length > maxFiles;
				const files = listed.slice(0, maxFiles);
				if (capped) return resolve({ files, truncated: true, cacheable: true });
				if (killedBy) return reject(new Error(`fd was stopped after ${LISTING_TIMEOUT_MS / 1000} s`));
				if (code === 0) return resolve({ files, truncated: countCapped, cacheable: true });
				// An error after some output (an unreadable subdirectory) is a partial listing: served, never cached.
				if (files.length > 0) return resolve({ files, truncated: true, cacheable: false });
				reject(new Error(`fd exited ${code}: ${err.trim()}`));
			});
		});
	};
}

interface Entry {
	at: number;
	listing: Promise<Listing>;
	controller: AbortController;
	waiters: number;
	settled: boolean;
}

export class FileSearch {
	private readonly list: ListFiles;
	private readonly now: () => number;
	/** Insertion order is recency: a hit is re-inserted, the first key is the least recently used. */
	private readonly cache = new Map<string, Entry>();
	private readonly latest = new Map<string, { ticket: number; supersede: () => void }>();
	private readonly shutdown = new AbortController();
	/** Running listings; a released slot passes straight to the next queued listing, so this never exceeds the limit. */
	private active = 0;
	private readonly slots: Array<() => void> = [];
	private sequence = 0;

	constructor(options: { list?: ListFiles; now?: () => number } = {}) {
		this.list = options.list ?? createFdLister();
		this.now = options.now ?? Date.now;
	}

	private acquire(signal: AbortSignal): Promise<void> {
		if (this.active < MAX_ACTIVE_LISTINGS) {
			this.active++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			// A waiter that gives up leaves the queue, so it can never absorb a hand-off.
			const onAbort = () => {
				const index = this.slots.indexOf(wake);
				if (index !== -1) this.slots.splice(index, 1);
				reject(signal.reason);
			};
			const wake = () => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			};
			this.slots.push(wake);
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	private release(): void {
		const next = this.slots.shift();
		if (next)
			next(); // the slot passes on: `active` stays the same
		else this.active--;
	}

	private async withSlot<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
		await this.acquire(signal);
		try {
			signal.throwIfAborted();
			return await run();
		} finally {
			this.release();
		}
	}

	/** Out of the cache; a running listing nobody waits for is aborted, which stops its process. */
	private drop(cwd: string, entry: Entry): void {
		if (this.cache.get(cwd) === entry) this.cache.delete(cwd);
		if (!entry.settled && entry.waiters === 0)
			entry.controller.abort(new AppServerError("internal", "listing no longer needed"));
	}

	private entryFor(cwd: string): Entry {
		const cached = this.cache.get(cwd);
		if (cached) {
			this.cache.delete(cwd);
			if (this.now() - cached.at < LISTING_TTL_MS) {
				this.cache.set(cwd, cached);
				return cached;
			}
			this.drop(cwd, cached);
		}
		const controller = new AbortController();
		const signal = AbortSignal.any([controller.signal, this.shutdown.signal]);
		const entry: Entry = {
			at: this.now(),
			listing: Promise.resolve({ files: [], truncated: false, cacheable: false }),
			controller,
			waiters: 0,
			settled: false,
		};
		entry.listing = this.withSlot(signal, () => this.list(cwd, signal)).then(
			(listing) => {
				entry.settled = true;
				if (!listing.cacheable && this.cache.get(cwd) === entry) this.cache.delete(cwd);
				return listing;
			},
			(error: unknown) => {
				entry.settled = true;
				if (this.cache.get(cwd) === entry) this.cache.delete(cwd); // a failed listing is never served again
				throw error;
			},
		);
		entry.listing.catch(() => {});
		this.cache.set(cwd, entry);
		while (this.cache.size > MAX_CACHED_CWDS) {
			const [oldest, evicted] = this.cache.entries().next().value!;
			this.drop(oldest, evicted);
		}
		return entry;
	}

	async search(params: ParamsOf<"file/search">): Promise<ResultOf<"file/search">> {
		if (this.shutdown.signal.aborted) throw new AppServerError("shuttingDown", "the app server is shutting down");
		const ticket = ++this.sequence;
		let superseded!: () => void;
		const supersededPromise = new Promise<"superseded">((resolve) => (superseded = () => resolve("superseded")));
		if (params.searchId !== undefined) {
			this.latest.get(params.searchId)?.supersede();
			this.latest.set(params.searchId, { ticket, supersede: superseded });
		}
		const cwd = resolvePath(params.cwd);
		const entry = this.entryFor(cwd);
		entry.waiters++;
		try {
			const outcome = await Promise.race([entry.listing, supersededPromise]);
			// Shutdown outranks a supersede even when the child rejects only on close.
			if (this.shutdown.signal.aborted) throw new AppServerError("shuttingDown", "the app server is shutting down");
			if (outcome === "superseded") return { files: [], truncated: false };
			const ranked = outcome.files
				.flatMap((path) => {
					const match = fuzzyScore(params.query, path);
					return match ? [{ path, ...match }] : [];
				})
				.sort((a, b) => b.score - a.score)
				.slice(0, params.limit ?? 50);
			return { files: ranked, truncated: outcome.truncated };
		} catch (error) {
			if (this.shutdown.signal.aborted) throw new AppServerError("shuttingDown", "the app server is shutting down");
			if (error instanceof AppServerError) throw error;
			throw new AppServerError(
				"internal",
				`file search failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			entry.waiters--;
			if (entry.waiters === 0 && !entry.settled) this.drop(cwd, entry);
			if (params.searchId !== undefined && this.latest.get(params.searchId)?.ticket === ticket)
				this.latest.delete(params.searchId);
		}
	}

	/** Abort every listing, running or queued, and refuse new searches. */
	close(): void {
		this.shutdown.abort(new AppServerError("shuttingDown", "the app server is shutting down"));
		this.cache.clear();
		for (const entry of this.latest.values()) entry.supersede();
		this.latest.clear();
	}
}
