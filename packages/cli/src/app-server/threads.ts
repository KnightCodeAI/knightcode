/**
 * Every live thread in the process (§5). Grows out of the engine's
 * createSessionRegistry (git show 954451f04^:packages/cli/src/engine/sessions.ts):
 * open de-duplication, close order and preflight come from there. The states
 * and the single load path are §5.6.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
	ApprovalMode,
	ParamsOf,
	ResultOf,
	Thread,
	ThreadSummary,
	Turn,
	WireTurn,
	ImageRef,
	TurnStartResult,
	Warning,
} from "@knightcode/app-server-protocol";
import type { AgentSession } from "../core/agent-session.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../core/agent-session-services.ts";
import type { InlineExtension } from "../core/extensions/types.ts";
import { getExtensionCacheStats } from "../core/extensions/loader.ts";
import {
	acquireSessionLock,
	type SessionLock,
	SessionHardLinkedError,
	SessionLockedError,
} from "../core/session-lock.ts";
import {
	loadEntriesFromFile,
	readSessionHeaderForDiscovery,
	SessionManager,
	type SessionEntry,
	sessionCwdMatches,
} from "../core/session-manager.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { builtInExtensions } from "../extensions/index.ts";
import { resolvePath } from "../utils/paths.ts";
import type { AppServerContext } from "./context.ts";
import { AppServerError } from "./errors.ts";
import { positionOf } from "./config.ts";
import { FileSearch } from "./file-search.ts";
import { APPROVAL_MODE_ENTRY, createApprovalExtension, readApprovalMode } from "./approvals.ts";
import { ItemMapper, queueOf, usageOf } from "./item-mapper.ts";
import { readImageInput } from "./image-input.ts";
import { StartRequest } from "./start-request.ts";
import { LoadedThread, titleOf } from "./loaded-thread.ts";
import { pageHistory, type HistoryPage } from "./history-pages.ts";
import { ListingPages } from "./listing-pages.ts";
import { type IndexedSession, listWithIndex, type ReadKind } from "./listing-index.ts";
import { PayloadStore } from "./payloads.ts";
import { readTurns, entryForItem, textOf } from "./transcript.ts";
import { type Commit, commitOnSend, type Handlers, type Subscriber } from "./server.ts";
import {
	ARCHIVE_DIR,
	parentIdOf,
	isArchivedPath,
	liveDirFor,
	moveSessionFileWithoutReplace,
	sessionDirs,
	SessionFileIndex,
} from "./session-files.ts";

const DEFAULT_IDLE_MS = 10 * 60_000;

export interface ThreadManagerOptions {
	idleMs?: number;
	/** `-e` paths: loaded in every thread as trusted CLI extensions. */
	extensionPaths?: string[];
	/** Inline extensions after the built-ins. Tests load fixtures here. */
	extraExtensions?: InlineExtension[];
	/** Built-ins to leave out, as the terminal's --no-mcp does. */
	disabledBuiltinExtensions?: string[];
}

export function defaultApprovalMode(mode: "desktop" | "tui"): ApprovalMode {
	return mode === "desktop" ? "ask" : "fullAccess";
}

// ponytail: a fixed list of built-in commands that do nothing outside the terminal (they need a picker or a
// terminal panel). Replace with command metadata or desktop dialogs when extension UI reaches the desktop (Phase C).
const TERMINAL_ONLY_COMMANDS = new Set(["usage", "llama", "undo"]);

function commandsOf(session: AgentSession): ResultOf<"command/list">["commands"] {
	return [
		...session.extensionRunner
			.getRegisteredCommands()
			.filter((command) => !TERMINAL_ONLY_COMMANDS.has(command.invocationName))
			.map((command) => ({ name: command.invocationName, description: command.description ?? "" })),
		...session.promptTemplates.map((template) => ({ name: template.name, description: template.description ?? "" })),
		...session.resourceLoader
			.getSkills()
			.skills.map((skill) => ({ name: `skill:${skill.name}`, description: skill.description ?? "" })),
	];
}

export class ThreadManager {
	readonly files: SessionFileIndex;
	readonly payloads: PayloadStore;
	readonly systemErrors = new Map<string, string>();
	private readonly listingPages = new ListingPages();
	private readonly fileSearch = new FileSearch();
	private readonly startedAt = Date.now();
	private listingFilesOpened = 0;
	private listingBytesScanned = 0;
	private readonly startsBySignal = new Map<AbortSignal, StartRequest>();
	private readonly ctx: AppServerContext;
	private readonly options: ThreadManagerOptions;
	private readonly idleMs: number;
	/** Ready threads only (§5.6). */
	private readonly threads = new Map<string, LoadedThread>();
	private readonly loading = new Map<string, Promise<LoadedThread>>();
	/** Unloads and archive moves in progress, as settled promises; a load of the same id waits for them. */
	private readonly closing = new Map<string, Promise<void>>();
	/** Every load operation (start, resume, fork, a replacement's load), from its first step; shutdown waits for all. */
	private readonly inFlight = new Set<Promise<unknown>>();
	private shuttingDown = false;

	constructor(ctx: AppServerContext, options: ThreadManagerOptions = {}) {
		this.ctx = ctx;
		this.options = options;
		this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
		this.files = new SessionFileIndex(ctx);
		this.payloads = new PayloadStore(ctx.agentDir);
	}

	diagnostics(): ResultOf<"server/diagnostics"> {
		const memory = process.memoryUsage();
		const payloads = this.payloads.getStats();
		return {
			rssBytes: memory.rss,
			heapBytes: memory.heapUsed,
			loadedThreads: this.threads.size,
			loadingThreads: this.loading.size,
			payloadFiles: payloads.payloads,
			payloadBytes: payloads.bytes,
			inactiveFactories: getExtensionCacheStats().inactive,
			uptimeMs: Date.now() - this.startedAt,
			listingFilesOpened: this.listingFilesOpened,
			listingBytesScanned: this.listingBytesScanned,
		};
	}

	loadedCount(): number {
		return this.threads.size;
	}

	get(threadId: string): LoadedThread {
		const thread = this.threads.get(threadId);
		if (!thread) throw new AppServerError("threadNotFound", `thread is not loaded: ${threadId}`);
		return thread;
	}

	private assertOpen(): void {
		if (this.shuttingDown) throw new AppServerError("shuttingDown", "the app server is shutting down");
	}

	/**
	 * Run a load operation as one tracked unit from its first step (§5.6): closeAll waits for it, and once
	 * shutdown began no new one starts. A resume's first await is the file lookup, before any session exists.
	 */
	private track<T>(operation: () => Promise<T>): Promise<T> {
		if (this.shuttingDown) return Promise.reject(new AppServerError("shuttingDown", "the app server is shutting down"));
		const work = operation();
		this.inFlight.add(work);
		const done = () => this.inFlight.delete(work);
		void work.then(done, done);
		return work;
	}

	start(params: ParamsOf<"thread/start">, by: Subscriber): Promise<ResultOf<"thread/start">> {
		return this.track(async () => {
			const cwd = resolvePath(params.cwd);
			const stats = await stat(cwd).catch(() => undefined);
			if (!stats?.isDirectory()) throw new AppServerError("invalidParams", `cwd is not a directory: ${params.cwd}`);
			const sessionManager = SessionManager.create(cwd, liveDirFor(this.ctx, cwd));
			const thread = await this.load(
				sessionManager,
				by.mode,
				"new",
				params.approvalMode ?? defaultApprovalMode(by.mode),
			);
			try {
				if (params.model) await this.setModel(thread, params.model.provider, params.model.id);
				if (params.thinkingLevel) thread.session.setThinkingLevel(params.thinkingLevel);
			} catch (error) {
				// A thread the client never got must not stay loaded.
				await this.unload(thread.id);
				throw error;
			}
			this.subscribe(thread, by);
			const summary = thread.toThread();
			this.ctx.broadcast("thread/started", { thread: summary });
			return { thread: summary, warnings: [...thread.loadWarnings] };
		});
	}

	async resume(
		threadId: string,
		cursor: string | undefined,
		by: Subscriber,
	): Promise<Commit<ResultOf<"thread/resume">>> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		// Subscribe in the same tick as the response is written (§4.5).
		return commitOnSend(() => {
			// An unload or archive may have taken the thread between the load and this answer (§5.6).
			if (thread.state !== "ready") throw new AppServerError("threadNotFound", `thread was closed: ${threadId}`);
			const summary = thread.toThread();
			const history = this.history(
				summary,
				thread.session.sessionManager.getBranch(),
				cursor,
				thread.mapper?.wireSnapshot(),
			);
			this.subscribe(thread, by);
			return {
				thread: summary,
				...history,
				queue: queueOf(thread),
				usage: usageOf(thread.session),
				warnings: [...thread.loadWarnings],
			};
		});
	}

	/** Only the mapper can identify the real active turn; isIdle alone cannot. */
	private liveTurns(thread: LoadedThread): Turn[] {
		const turns = readTurns(thread.id, thread.session.sessionManager.getBranch(), thread.mapper.currentTurnId());
		const running = thread.mapper.snapshot();
		if (!running) return turns;
		if (turns.at(-1)?.id === running.id) turns[turns.length - 1] = running;
		else turns.push(running);
		return turns;
	}

	private history(
		thread: Thread | ThreadSummary,
		entries: readonly SessionEntry[],
		cursor?: string,
		runningTurn?: WireTurn,
	): HistoryPage {
		return pageHistory({ thread, entries, cursor, runningTurn }, this.payloads);
	}

	/** Read-only active-branch reconstruction: no live lock and no transcript repair. */
	private branchOf(file: string): { entries: SessionEntry[]; manager: SessionManager } {
		const manager = SessionManager.inMemory(process.cwd(), undefined, loadEntriesFromFile(file));
		return { entries: manager.getBranch(), manager };
	}

	async list(params: ParamsOf<"thread/list">): Promise<ResultOf<"thread/list">> {
		this.assertOpen();
		return this.listingPages.page(params, async () => {
			const archived = params.archived === true;
			const onRead = (_path: string, _kind: ReadKind, bytes: number) => {
				this.listingFilesOpened++;
				this.listingBytesScanned += bytes;
			};
			let sessions: IndexedSession[] = [];
			if (params.cwd !== undefined) {
				const cwd = resolvePath(params.cwd);
				const live = liveDirFor(this.ctx, cwd);
				const dir = archived ? join(live, ARCHIVE_DIR) : live;
				if (existsSync(dir)) sessions = await listWithIndex(dir, { onRead });
				if (this.ctx.sessionDir !== undefined) sessions = sessions.filter((s) => sessionCwdMatches(s.cwd, cwd));
			} else {
				// Sequential directories keep the whole listing at at most 64 concurrent scans.
				for (const dir of await sessionDirs(this.ctx, archived))
					sessions.push(...(await listWithIndex(dir, { onRead })));
			}
			return sessions
				.filter((info) => info.messageCount > 0)
				.sort((a, b) => b.modified.getTime() - a.modified.getTime())
				.map((info): ThreadSummary => {
					const live = this.threads.get(info.id);
					return {
						id: info.id,
						cwd: info.cwd,
						projectCwd: info.cwd,
						name: info.title,
						status: live?.status() ?? this.unloadedStatus(info.id),
						createdAt: info.created.toISOString(),
						forkedFromId: info.forkedFromId,
						archived: isArchivedPath(info.path),
						updatedAt: info.modified.toISOString(),
					};
				});
		});
	}

	async read(threadId: string, cursor?: string): Promise<ResultOf<"thread/read">> {
		this.assertOpen();
		const live = this.threads.get(threadId);
		if (live) {
			const thread = live.toThread();
			return {
				thread,
				...this.history(thread, live.session.sessionManager.getBranch(), cursor, live.mapper?.wireSnapshot()),
			};
		}
		const file = await this.files.find(threadId);
		this.assertOpen();
		if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
		const { entries, manager } = this.branchOf(file);
		const header = manager.getHeader();
		const firstUser = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
		const firstText =
			firstUser?.type === "message" && firstUser.message.role === "user" ? textOf(firstUser.message.content) : "";
		const thread: ThreadSummary = {
			id: threadId,
			cwd: header?.cwd ?? "",
			projectCwd: header?.cwd ?? "",
			name: titleOf(manager.getSessionName(), firstText),
			status: this.unloadedStatus(threadId),
			createdAt: header?.timestamp ?? "",
			forkedFromId: parentIdOf(header?.parentSession),
			archived: isArchivedPath(file),
			updatedAt: statSync(file).mtime.toISOString(),
		};
		return { thread, ...this.history(thread, entries, cursor) };
	}

	async withThread<T>(threadId: string, mode: "desktop" | "tui", fn: (thread: LoadedThread) => Promise<T>): Promise<T> {
		const thread = await this.ensureLoaded(threadId, mode);
		return thread.hold(() => fn(thread));
	}

	async archive(threadId: string, archived: boolean): Promise<void> {
		this.assertOpen();
		const live = this.threads.get(threadId);
		if (live?.busy) throw new AppServerError("turnInProgress", "interrupt the turn first");
		await this.transition(threadId, async (thread) => {
			if (thread) {
				await thread.dispose();
				this.ctx.broadcast("thread/status/changed", { threadId, status: this.unloadedStatus(threadId) });
			}
			const file = await this.files.find(threadId);
			if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
			if (isArchivedPath(file) === archived) return;
			const target = archived ? join(dirname(file), ARCHIVE_DIR) : dirname(dirname(file));
			await mkdir(target, { recursive: true });
			const moved = join(target, basename(file));
			await moveSessionFileWithoutReplace(file, moved, threadId, () => this.files.remember(threadId, moved));
		});
		this.ctx.broadcast("thread/archived", { threadId, archived });
	}

	async delete(threadId: string): Promise<void> {
		this.assertOpen();
		const found = await this.files.find(threadId);
		if (!found) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
		if (!isArchivedPath(found)) throw new AppServerError("threadNotArchived", "archive the thread before deleting it");
		// No await between the busy check and transition's synchronous ready-map removal.
		if (this.threads.get(threadId)?.busy) throw new AppServerError("turnInProgress", "interrupt the turn first");
		await this.transition(threadId, async (thread) => {
			// Refusals before disposal restore the original ready thread and its subscribers.
			let file: string | undefined;
			try {
				file = await this.files.find(threadId);
				if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
				if (!isArchivedPath(file))
					throw new AppServerError("threadNotArchived", "archive the thread before deleting it");
				if (thread?.busy) throw new AppServerError("turnInProgress", "interrupt the turn first");
			} catch (error) {
				if (thread?.state === "ready") this.threads.set(threadId, thread);
				throw error;
			}
			if (thread) {
				await thread.dispose();
				this.ctx.broadcast("thread/status/changed", { threadId, status: { type: "notLoaded" } });
			}
			let lock: SessionLock;
			try {
				lock = acquireSessionLock(file, undefined, true);
			} catch (error) {
				if (error instanceof SessionLockedError)
					throw new AppServerError("threadLockedElsewhere", "the thread is open in another KnightCode process");
				if (error instanceof SessionHardLinkedError)
					throw new AppServerError("archiveConflict", error.message, {
						reason: "duplicateLinks",
						paths: await this.files.findAll(threadId),
					});
				throw error;
			}
			try {
				if (readSessionHeaderForDiscovery(file)?.id !== threadId)
					throw new AppServerError("threadNotFound", `the file no longer holds thread ${threadId}`);
				if (lock.lost) throw new AppServerError("threadLockedElsewhere", "another process took the file");
				await unlink(file).catch((error: unknown) => {
					throw new AppServerError(
						"internal",
						`could not delete ${file}: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
			} finally {
				lock.release();
			}
			this.files.forget(threadId);
			this.systemErrors.delete(threadId);
		});
		this.ctx.broadcast("thread/deleted", { threadId });
	}

	fork(threadId: string, atItemId: string | undefined, by: Subscriber): Promise<ResultOf<"thread/fork">> {
		return this.track(async () => {
			const live = this.threads.get(threadId);
			const source = live?.file ?? (await this.files.find(threadId));
			if (!source || !existsSync(source)) throw new AppServerError("threadNotFound", `nothing to fork: ${threadId}`);
			this.assertOpen();
			// A live thread's leaf can move without an append, so its item ids come from the in-memory branch.
			const { entries, manager } = live
				? { entries: live.session.sessionManager.getBranch(), manager: live.session.sessionManager }
				: this.branchOf(source);
			const cwd = live?.session.sessionManager.getCwd() ?? manager.getHeader()?.cwd ?? process.cwd();
			const leafId = atItemId === undefined ? undefined : entryForItem(entries, atItemId);
			if (atItemId !== undefined && leafId === undefined)
				throw new AppServerError("invalidParams", `no item ${atItemId} in ${threadId}`);
			const sessionManager = SessionManager.forkFrom(
				source,
				cwd,
				liveDirFor(this.ctx, cwd),
				leafId === undefined ? undefined : { leafId },
			);
			const thread = await this.load(
				sessionManager,
				by.mode,
				"fork",
				live?.approvalMode ?? defaultApprovalMode(by.mode),
			);
			if (thread.state !== "ready")
				throw new AppServerError("threadNotFound", `fork closed while loading: ${thread.id}`);
			// The copy carries its source's name; mark it so the two can be told apart.
			thread.session.setSessionName(`${thread.toThread().name} (fork)`);
			this.subscribe(thread, by);
			const summary = thread.toThread();
			this.ctx.broadcast("thread/started", { thread: summary });
			return { thread: summary, warnings: [...thread.loadWarnings] };
		});
	}

	/** The only way to a loaded thread (§5.6). Never two sessions on one file. */
	async ensureLoaded(threadId: string, mode: "desktop" | "tui"): Promise<LoadedThread> {
		for (;;) {
			this.assertOpen();
			const closing = this.closing.get(threadId);
			if (closing) {
				// The old session must release the file (or the archive move finish) first.
				await closing.catch(() => {});
				continue;
			}
			const live = this.threads.get(threadId);
			if (live) return live;
			const inFlight = this.loading.get(threadId);
			if (inFlight) return inFlight;
			const loading = this.track(() => this.loadSaved(threadId, mode));
			this.loading.set(threadId, loading);
			try {
				return await loading;
			} finally {
				this.loading.delete(threadId);
			}
		}
	}

	private async loadSaved(threadId: string, mode: "desktop" | "tui"): Promise<LoadedThread> {
		const file = await this.files.find(threadId);
		if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
		// Shutdown may have begun during the lookup; do not take a lock it would have to release.
		this.assertOpen();
		let sessionManager: SessionManager;
		try {
			sessionManager = SessionManager.open(file);
		} catch (error) {
			if (error instanceof SessionLockedError) {
				throw new AppServerError("threadLockedElsewhere", "the thread is open in another KnightCode process");
			}
			if (error instanceof SessionHardLinkedError) {
				// An archive move interrupted between link and unlink (§5.8): report every name, open none.
				const paths = await this.files.findAll(threadId);
				throw new AppServerError("archiveConflict", error.message, {
					reason: "duplicateLinks",
					paths,
					recoveryInstructions: [
						"These names are one file. Keep the one in the directory where the thread belongs and delete the other name, then open the thread again.",
					],
				});
			}
			throw error;
		}
		return this.load(sessionManager, mode, "resume");
	}

	subscribe(thread: LoadedThread, by: Subscriber): void {
		// A connection that closed while its load was in flight never gets a subscription it cannot drop.
		if (by.isClosed) return this.scheduleIdle(thread);
		thread.subscribers.add(by);
		clearTimeout(thread.idleTimer);
		thread.idleTimer = undefined;
	}

	unsubscribe(threadId: string, by: Subscriber): boolean {
		const thread = this.threads.get(threadId);
		if (!thread) return false;
		const subscribed = thread.subscribers.delete(by);
		if (thread.lastTurnSubscriber === by) thread.lastTurnSubscriber = undefined;
		// An approval waiting on `by` would otherwise wait for a dialog it may no longer show (§4.5).
		thread.withdrawFrom(by);
		this.scheduleIdle(thread);
		return subscribed;
	}

	disconnect(by: Subscriber): void {
		for (const thread of this.threads.values()) {
			if (thread.subscribers.has(by)) this.unsubscribe(thread.id, by);
		}
	}

	/** Start the idle timer when nobody watches and nothing holds the thread (§5.6). */
	scheduleIdle(thread: LoadedThread): void {
		if (thread.state !== "ready" || thread.subscribers.size > 0 || thread.busy || thread.idleTimer) return;
		thread.idleTimer = setTimeout(() => {
			thread.idleTimer = undefined;
			// Something may have started since the timer was set.
			if (thread.subscribers.size === 0 && !thread.busy) void this.unload(thread.id);
		}, this.idleMs);
		thread.idleTimer.unref?.();
	}

	/**
	 * Run `step` as the id's one closing transition (§5.6). Unload and archive both use it. The id is
	 * reserved in `closing` at once, so later requests wait; a ready thread leaves the ready map in the
	 * same step. A load of the id already under way finishes first, and its thread is taken then: closing
	 * around it would leave its session on a file the step moves. The map holds the same settled promise it
	 * later compares against, and a step waits only on the transition before it, never on its own entry.
	 */
	private transition(threadId: string, step: (thread: LoadedThread | undefined) => Promise<void>): Promise<void> {
		const previous = this.closing.get(threadId);
		const ready = this.threads.get(threadId);
		this.threads.delete(threadId);
		const work = (async () => {
			await previous;
			await this.loading.get(threadId)?.catch(() => {});
			const thread = ready ?? this.threads.get(threadId);
			this.threads.delete(threadId);
			await step(thread);
		})();
		const entry = work.then(
			() => undefined,
			() => undefined,
		);
		this.closing.set(threadId, entry);
		void entry.then(() => {
			if (this.closing.get(threadId) === entry) this.closing.delete(threadId);
		});
		return work;
	}

	/** Moves the thread from ready to closing in one step, so no request sees it in neither. */
	async unload(
		threadId: string,
		reason: "quit" | "new" | "resume" | "fork" = "quit",
		targetSessionFile?: string,
		options: { waitForQueue?: boolean } = {},
	): Promise<void> {
		if (!this.threads.has(threadId)) return this.closing.get(threadId);
		await this.transition(threadId, (thread) =>
			thread!.dispose(reason, targetSessionFile, options.waitForQueue ?? true),
		);
		this.ctx.broadcast("thread/status/changed", { threadId, status: this.unloadedStatus(threadId) });
	}

	private unloadedStatus(threadId: string): ThreadSummary["status"] {
		const message = this.systemErrors.get(threadId);
		return message === undefined ? { type: "notLoaded" } : { type: "systemError", message };
	}

	/** Refuse new loads, wait for every load operation in flight, then unload everything in parallel (§5.6). */
	async closeAll(): Promise<void> {
		this.shuttingDown = true;
		this.fileSearch.close();
		// Loop: an operation may still be inside track() when the snapshot is taken.
		while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
		await Promise.allSettled([...this.threads.keys()].map((id) => this.unload(id)));
		await Promise.allSettled([...this.closing.values()]);
		this.listingPages.clear();
		await this.payloads.close();
	}

	private async setModel(thread: LoadedThread, provider: string, id: string): Promise<void> {
		const model = this.ctx.models.getModel(provider, id);
		if (!model) throw new AppServerError("invalidParams", `no such model: ${provider}/${id}`);
		try {
			await thread.session.setModel(model);
		} catch (error) {
			throw new AppServerError("authRequired", error instanceof Error ? error.message : String(error));
		}
	}

	/**
	 * Every session build goes through here. Tracked as well, so a replacement's load (Task 13), which no
	 * other operation wraps, is waited for; a manager the caller already opened is closed if shutdown refuses.
	 */
	private load(
		sessionManager: SessionManager,
		mode: "desktop" | "tui",
		reason: "new" | "resume" | "fork",
		approvalMode?: ApprovalMode,
	): Promise<LoadedThread> {
		const building = this.track(() => this.build(sessionManager, mode, reason, approvalMode)).catch(
			(error: unknown) => {
				if (error instanceof AppServerError && error.code === "shuttingDown") sessionManager.close();
				throw error;
			},
		);
		// Every build is visible by id while it runs (§5.6), not only those ensureLoaded starts. A fork's or a
		// replacement's file exists before its load finishes, so thread/list can show it: a resume of that id must
		// join this build instead of opening a second session on the file (the in-process lock is counted and would
		// let it), and an archive must wait for it. ensureLoaded's own entry, which also covers the file lookup,
		// stays in place when it is the caller.
		const id = sessionManager.getSessionId();
		if (!this.loading.has(id)) {
			this.loading.set(id, building);
			const clear = () => {
				if (this.loading.get(id) === building) this.loading.delete(id);
			};
			void building.then(clear, clear);
		}
		return building;
	}

	/**
	 * Build a session the way the terminal does (main.ts:844-975), over the shared ModelRuntime.
	 * `approvalMode` is the effective mode for a new thread; a resumed thread restores its own (Task 12).
	 */
	private async build(
		sessionManager: SessionManager,
		mode: "desktop" | "tui",
		reason: "new" | "resume" | "fork",
		approvalMode?: ApprovalMode,
	): Promise<LoadedThread> {
		const cwd = sessionManager.getCwd();
		let created: LoadedThread | undefined;
		let services: Awaited<ReturnType<typeof createAgentSessionServices>> | undefined;
		let session: AgentSession | undefined;
		try {
			const holder: { thread?: LoadedThread } = {};
			services = await this.servicesFor(cwd, holder);
			({ session } = await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason },
				model: this.ctx.defaultModel,
			}));
			const stored = reason === "resume" ? readApprovalMode(sessionManager.getBranch()) : undefined;
			const effective = stored ?? approvalMode ?? defaultApprovalMode(mode);
			if (reason !== "resume") sessionManager.appendCustomEntry(APPROVAL_MODE_ENTRY, effective);
			const thread = new LoadedThread(
				session,
				cwd,
				effective,
				() => this.afterActivity(thread),
				this.payloads,
				this.ctx.broadcast,
				parentIdOf(sessionManager.getHeader()?.parentSession),
			);
			created = thread;
			holder.thread = thread;
			await this.bind(thread, mode);
			thread.mapper = new ItemMapper(
				thread,
				(method, params) => this.ctx.broadcast(method, params),
				() => this.afterSettle(thread),
			);
			thread.mapper.restore(readTurns(thread.id, session.sessionManager.getBranch()));
			thread.unsubscribeSession = session.subscribe((event) => thread.mapper.handle(event));
			for (const diagnostic of session.settingsManager.drainErrors()) {
				let content = "";
				try {
					if (diagnostic.path) content = readFileSync(diagnostic.path, "utf8");
				} catch {
					/* Diagnostic survives a removed file. */
				}
				thread.loadWarnings.push({
					source: "settings",
					message: diagnostic.error.message,
					...(diagnostic.path ? { path: diagnostic.path } : {}),
					...positionOf(content, diagnostic.error),
				});
			}
			const extensions = session.resourceLoader.getExtensions();
			for (const { path, error } of extensions.errors)
				thread.loadWarnings.push({ source: "extension", path, message: error });
			for (const { path, warning } of extensions.warnings ?? [])
				thread.loadWarnings.push({ source: "extension", path, message: warning });
			for (const diagnostic of services.diagnostics)
				if (diagnostic.type !== "info") thread.loadWarnings.push({ source: "extension", message: diagnostic.message });
			if (hasTrustRequiringProjectResources(cwd) && new ProjectTrustStore(this.ctx.agentDir).get(cwd) === null)
				thread.loadWarnings.push({
					source: "trust",
					message:
						"This project has its own extensions and settings; they were not loaded. Trust the project to use them.",
				});
			// A shutdown that began during the load must not leave this thread behind.
			this.assertOpen();
			this.threads.set(thread.id, thread);
			if (this.systemErrors.delete(thread.id)) thread.broadcastStatus();
			if (thread.file) this.files.remember(thread.id, thread.file);
			// No model is fine: an extension provider may register later, and turn/start answers authRequired (§5.2).
			return thread;
		} catch (error) {
			// Disposing the thread or session closes the manager and releases the loader's cache leases (Task 5)
			// and its virtual-model routes (Task 4). Before a session exists, nothing else owns those: the
			// services flush already registered the routes, so release routes and leases, and close the manager.
			if (created) await created.dispose();
			else if (session) session.dispose();
			else {
				if (services) {
					this.ctx.models.releaseVirtualModels(services.resourceLoader.getExtensions().runtime);
					services.resourceLoader.releaseExtensionCache?.();
				}
				sessionManager.close();
			}
			throw error;
		}
	}

	/** The services a thread's session is built from; `holder.thread` is set once the thread exists. */
	private servicesFor(cwd: string, holder: { thread?: LoadedThread }) {
		const projectTrusted =
			!hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(this.ctx.agentDir).get(cwd) === true;
		return createAgentSessionServices({
			cwd,
			agentDir: this.ctx.agentDir,
			modelRuntime: this.ctx.models,
			settingsManager: SettingsManager.create(cwd, this.ctx.agentDir, { projectTrusted }),
			resourceLoaderOptions: {
				extensionFactories: [
					...builtInExtensions,
					...this.threadExtensions(holder),
					...(this.options.extraExtensions ?? []),
					// Inline extensions load after all others, so this input handler runs last.
					{
						name: "app-server-start-guard",
						hidden: true,
						factory: (knightcode) => {
							// A start interrupted during earlier input handlers or a command launches nothing.
							knightcode.on("input", () =>
								holder.thread?.dispatching?.signal.aborted ? { action: "handled" as const } : undefined,
							);
						},
					},
				],
				additionalExtensionPaths: this.options.extensionPaths,
				disabledBuiltinExtensions: this.options.disabledBuiltinExtensions,
			},
		});
	}

	/**
	 * Commands for a project that has no thread yet: an in-memory session that is never bound, so no
	 * extension starts and nothing is written. Extensions register their commands as they load.
	 */
	private commandsFor(cwdParam: string): Promise<ResultOf<"command/list">> {
		return this.track(async () => {
			const cwd = resolvePath(cwdParam);
			const stats = await stat(cwd).catch(() => undefined);
			if (!stats?.isDirectory()) throw new AppServerError("invalidParams", `cwd is not a directory: ${cwdParam}`);
			const services = await this.servicesFor(cwd, {});
			let session: AgentSession | undefined;
			try {
				({ session } = await createAgentSessionFromServices({
					services,
					sessionManager: SessionManager.inMemory(cwd),
				}));
				return { commands: commandsOf(session) };
			} finally {
				if (session) session.dispose();
				else {
					this.ctx.models.releaseVirtualModels(services.resourceLoader.getExtensions().runtime);
					services.resourceLoader.releaseExtensionCache?.();
				}
			}
		});
	}

	/** Per-thread bridge for model changes, which are extension-only events. */
	private threadExtensions(holder: { thread?: LoadedThread }): InlineExtension[] {
		return [
			{
				name: "app-server-bridge",
				hidden: true,
				factory: (knightcode) => {
					knightcode.on("model_select", () => {
						const thread = holder.thread;
						if (thread) thread.notify("thread/settings/updated", { thread: thread.toThread() });
					});
				},
			},
			createApprovalExtension(holder),
		];
	}

	private afterSettle(thread: LoadedThread): void {
		if (thread.session.sessionManager.hasLostLock()) {
			this.systemErrors.set(
				thread.id,
				"Another KnightCode process took this thread's session file; it was closed here.",
			);
			for (const subscriber of thread.subscribers)
				subscriber.notify("error", {
					threadId: thread.id,
					message: "Another KnightCode process took this thread's session file; it was closed here.",
				});
			void this.unload(thread.id);
			return;
		}
		// A microtask is not enough: deferred prompts can await hooks before entering the next run.
		if (thread.state === "ready")
			void thread.session.waitForIdle({ includeSettlement: true }).then(() => this.afterActivity(thread));
	}

	/** Something on the thread ended: start the next queued input, else let the idle timer run. */
	private afterActivity(thread: LoadedThread): void {
		this.drainQueue(thread);
		this.scheduleIdle(thread);
	}

	private notifyQueue(thread: LoadedThread): void {
		thread.notify("turn/queue/updated", { threadId: thread.id, ...queueOf(thread) });
	}

	/**
	 * Start the oldest queued input once nothing else runs (Codex's queue, codex-rs/ext/queue): the input
	 * starts a turn of its own, so the agent's loop never holds input a client could still remove.
	 */
	private drainQueue(thread: LoadedThread): void {
		if (thread.state !== "ready" || thread.draining || thread.busy || thread.reservedStart) return;
		const next = thread.queued.shift();
		if (!next) return;
		thread.draining = true;
		this.notifyQueue(thread);
		void this.startTurn(thread.id, next.text, next.images, next.by, undefined, next.clientMessageId)
			.catch((error: unknown) => {
				// Dropped, not retried: a start that failed (no model, signed out) would fail again in a loop.
				thread.notify("error", {
					threadId: thread.id,
					message: `A queued message could not start: ${error instanceof Error ? error.message : String(error)}`,
				});
			})
			.finally(() => {
				thread.draining = false;
				this.afterActivity(thread);
			});
	}

	async addQueued(
		threadId: string,
		text: string,
		images: ImageRef[] | undefined,
		clientMessageId: string | undefined,
		by: Subscriber,
	): Promise<{ queueId: string }> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		this.subscribe(thread, by);
		const queueId = randomUUID();
		thread.queued.push({ id: queueId, text, images, clientMessageId, by });
		this.notifyQueue(thread);
		this.drainQueue(thread);
		return { queueId };
	}

	removeQueued(threadId: string, queueId: string): boolean {
		const thread = this.get(threadId);
		const index = thread.queued.findIndex((entry) => entry.id === queueId);
		if (index === -1) return false;
		thread.queued.splice(index, 1);
		this.notifyQueue(thread);
		return true;
	}

	private setApprovalMode(thread: LoadedThread, mode: ApprovalMode): void {
		if (thread.approvalMode === mode) return;
		thread.session.sessionManager.appendCustomEntry(APPROVAL_MODE_ENTRY, mode);
		thread.approvalMode = mode;
	}

	async startTurn(
		threadId: string,
		text: string,
		images: ImageRef[] | undefined,
		by: Subscriber,
		requestId?: string,
		clientMessageId?: string,
	): Promise<TurnStartResult> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		this.subscribe(thread, by);
		// Refuse an already-lost binding before registering a start that unload would cancel.
		if (thread.session.sessionManager.hasLostLock()) {
			this.afterSettle(thread);
			throw new AppServerError("threadLockedElsewhere", "the session file is no longer owned here");
		}
		const request = new StartRequest(thread, requestId);
		const start = request.controller;
		let acceptTurn: (() => void) | undefined;
		this.startsBySignal.set(start.signal, request);
		thread.pendingStarts.add(start);
		const work = (async (): Promise<TurnStartResult> => {
			try {
				await thread.exclusive(async () => {
					if (start.signal.aborted) {
						request.record("cancelled");
						return;
					}
					if (thread.reservedStart && thread.reservedStart !== start)
						throw new AppServerError("turnInProgress", "replacement preflight reserved this thread");
					const { session } = thread;
					if (session.sessionManager.hasLostLock()) {
						this.afterSettle(thread);
						throw new AppServerError("threadLockedElsewhere", "the session file is no longer owned here");
					}
					if (!session.isIdle || session.isSettling)
						throw new AppServerError("turnInProgress", "a turn or compaction is running");
					const model = session.model;
					if (!model)
						throw new AppServerError("authRequired", "no model selected; pick one with thread/settings/update");
					const authorized =
						this.ctx.models.hasConfiguredAuth(model.provider) ||
						(await this.ctx.models.checkAuth(model.provider)) !== undefined;
					if (start.signal.aborted) {
						request.record("cancelled");
						return;
					}
					if (!authorized) throw new AppServerError("authRequired", `not signed in to ${model.provider}`);
					thread.lastTurnSubscriber = by;
					thread.pendingTurnRequestId = request.requestId;
					thread.pendingClientMessageId = clientMessageId;
					let accepted = false;
					// Preflight (input hooks, commands, before_agent_start) runs to completion even when the start is
					// interrupted meanwhile; the session has no cancellation of its own there (architecture.md 4.7).
					thread.dispatching = start;
					// Closing answers at once: the session is disposed, so a hook that never returns cannot hold EOF.
					let release!: () => void;
					const closing = new Promise<void>((resolve) => {
						release = resolve;
					});
					const onAbort = () => {
						if (request.owner.state === "ready") return;
						request.record("cancelled");
						release();
					};
					start.signal.addEventListener("abort", onAbort, { once: true });
					try {
						const prompting = new Promise<void>((resolve, reject) => {
							void session
								.prompt(text, {
									images: images?.map((image) => ({ type: "image" as const, ...image })),
									source: "rpc",
									preflightResult: (disposition) => {
										if (disposition === "queued") {
											reject(new AppServerError("turnInProgress", "start unexpectedly queued on a running target"));
											return;
										}
										if (disposition === "started") {
											// Interrupted during preflight: the run stops at agent_start and the turn ends interrupted.
											if (start.signal.aborted) request.owner.session.abort().catch(() => {});
											acceptTurn = () => {
												request.record("started");
												accepted = request.disposition === "started";
												resolve();
											};
											request.owner.acceptTurnStart = acceptTurn;
											return;
										}
										request.record(disposition === "handled" && start.signal.aborted ? "cancelled" : disposition);
										accepted = request.disposition === "started";
										resolve();
									},
								})
								.then(() => {
									if (!accepted) {
										request.record(start.signal.aborted ? "cancelled" : "handled");
										resolve();
									}
								})
								.catch((error: unknown) => {
									if (accepted) request.owner.mapper.settled(false, error);
									else if (request.owner.session.sessionManager.hasLostLock()) {
										this.afterSettle(request.owner);
										reject(new AppServerError("threadLockedElsewhere", "the session file is no longer owned here"));
									} else reject(new AppServerError("internal", error instanceof Error ? error.message : String(error)));
								});
						});
						await Promise.race([prompting, closing]);
					} finally {
						start.signal.removeEventListener("abort", onAbort);
						if (thread.dispatching === start) thread.dispatching = undefined;
						if (request.owner.dispatching === start) request.owner.dispatching = undefined;
					}
				}, false);
				return request.result();
			} catch (error) {
				if (!start.signal.aborted) throw error;
				request.record("cancelled");
				return request.result();
			} finally {
				const owner = request.owner;
				if (owner.acceptTurnStart === acceptTurn) owner.acceptTurnStart = undefined;
				owner.pendingStarts.delete(start);
				if (owner.reservedStart === start) owner.reservedStart = undefined;
				if (request.disposition !== "started" && owner.pendingTurnRequestId === request.requestId) {
					owner.pendingTurnRequestId = undefined;
					owner.pendingClientMessageId = undefined;
				}
				this.startsBySignal.delete(start.signal);
				this.scheduleIdle(owner);
			}
		})();
		// Interrupted before its run exists, the start launches nothing (the start guard answers its input),
		// so answer now; the preflight finishes in the background, still holding the thread's queue.
		const early = new Promise<TurnStartResult>((resolve) => {
			const onAbort = () => {
				if (request.disposition || !request.owner.session.isIdle) return;
				request.record("cancelled");
				resolve(request.result());
			};
			start.signal.addEventListener("abort", onAbort, { once: true });
			const detach = () => start.signal.removeEventListener("abort", onAbort);
			work.then(detach, detach);
		});
		return Promise.race([work, early]);
	}

	/** Hand input to the running turn through the agent's own steering; it cannot be taken back. */
	async steer(threadId: string, expectedTurnId: string, text: string, images: ImageRef[] | undefined): Promise<void> {
		const thread = this.get(threadId);
		if (!thread.session.isStreaming) throw new AppServerError("invalidParams", "no turn is running; use turn/start");
		if (thread.mapper.currentTurnId() !== expectedTurnId)
			throw new AppServerError("turnMismatch", "the owning turn changed");
		await thread.hold(async () => {
			const session = thread.session;
			const turnId = thread.mapper.currentTurnId();
			const controller = new AbortController();
			let accepted = false;
			const onAbort = () =>
				rejectCancelled(new AppServerError("invalidParams", "the queued input's turn ended or was interrupted"));
			let rejectCancelled!: (error: Error) => void;
			const cancelled = new Promise<never>((_resolve, reject) => {
				rejectCancelled = reject;
			});
			controller.signal.addEventListener("abort", onAbort, { once: true });
			thread.pending.add(controller);
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "agent_settled" && !accepted) controller.abort();
			});
			try {
				const options = {
					source: "rpc" as const,
					preflightResult: () => {
						if (
							controller.signal.aborted ||
							thread.state !== "ready" ||
							!session.isStreaming ||
							thread.mapper.currentTurnId() !== turnId
						)
							throw new AppServerError("turnMismatch", "the queued input no longer belongs to a running turn");
						accepted = true;
						thread.pending.delete(controller);
					},
				};
				const content = images?.map((image) => ({ type: "image" as const, ...image }));
				await Promise.race([session.steer(text, content, options), cancelled]);
				if (!accepted) throw new AppServerError("invalidParams", "the steer was cancelled");
			} finally {
				controller.signal.removeEventListener("abort", onAbort);
				unsubscribe();
				thread.pending.delete(controller);
			}
		});
	}

	/**
	 * Stop the turn. Queued inputs are dropped as the terminal's Escape drops them: the client still has
	 * their text from turn/queue/updated, to put back in the composer.
	 */
	async interrupt(threadId: string, turnId?: string): Promise<void> {
		const thread = this.threads.get(threadId);
		if (turnId !== undefined && thread?.mapper.currentTurnId() !== turnId)
			throw new AppServerError("turnMismatch", "the owning turn changed");
		if (!thread) return;
		if (thread.queued.length > 0) {
			thread.queued.length = 0;
			this.notifyQueue(thread);
		}
		const starting = thread.pendingStarts.size > 0;
		for (const start of thread.pendingStarts) start.abort();
		thread.abortPending();
		const stopped = thread.session.abort();
		// A start still in preflight keeps the session busy until its hooks return; the turn ends as
		// cancelled then, so the interrupt does not wait for an extension handler.
		if (starting) stopped.catch(() => {});
		else await stopped;
	}

	private async cancelled(
		thread: LoadedThread,
		event:
			| { type: "session_before_switch"; reason: "new" | "resume"; targetSessionFile?: string }
			| { type: "session_before_fork"; entryId: string; position: "before" | "at" },
		signal?: AbortSignal,
	): Promise<boolean> {
		if (signal?.aborted) return true;
		const runner = thread.session.extensionRunner;
		if (!runner.hasHandlers(event.type)) return false;
		return (await runner.emit(event))?.cancel === true || signal?.aborted === true;
	}

	/** Publish a replacement atomically with cancellation ownership, then invalidate the old session. */
	async replace(
		old: LoadedThread,
		obtain: () => Promise<LoadedThread>,
		reason: "new" | "resume" | "fork",
		signal?: AbortSignal,
		willDispatch = false,
	): Promise<LoadedThread> {
		const initiating = signal && this.startsBySignal.get(signal);
		const known = new Set([...this.threads.keys(), ...this.loading.keys()]);
		const next = await obtain();
		if (next === old) return old;
		try {
			this.assertOpen();
			// Cancelled preflight has already released serialization. It must not publish over newer work.
			if (
				signal?.aborted ||
				(initiating && (this.startsBySignal.get(signal!) !== initiating || initiating.owner !== old))
			) {
				throw new Error("Session replacement was cancelled");
			}
			if (old.state !== "ready" || next.state !== "ready")
				throw new AppServerError("threadNotFound", "replacement thread was closed");
			const request = signal && this.startsBySignal.get(signal);
			if (request && request.owner === old) {
				if (willDispatch && (next.busy || next.reservedStart || next.pendingStarts.size > 0))
					throw new AppServerError("turnInProgress", "replacement target is busy");
				old.pendingStarts.delete(request.controller);
				if (old.reservedStart === request.controller) old.reservedStart = undefined;
				request.owner = next;
				next.pendingStarts.add(request.controller);
				// The replacement's own dispatch (withSession) belongs to the same start.
				if (old.dispatching === request.controller) next.dispatching = request.controller;
				if (willDispatch) next.reservedStart = request.controller;
				if (old.pendingTurnRequestId === request.requestId) {
					next.pendingClientMessageId = old.pendingClientMessageId;
					old.pendingTurnRequestId = undefined;
					old.pendingClientMessageId = undefined;
				}
				next.pendingTurnRequestId = request.requestId;
			}
		} catch (error) {
			// A reused or concurrently claimed target belongs to its other callers, not this failed replacement.
			if (!known.has(next.id) && next.subscribers.size === 0 && next.pendingStarts.size === 0 && !next.busy)
				await this.unload(next.id);
			throw error;
		}
		for (const subscriber of [...old.subscribers]) {
			old.subscribers.delete(subscriber);
			old.withdrawFrom(subscriber);
			this.subscribe(next, subscriber);
		}
		next.lastTurnSubscriber = old.lastTurnSubscriber ?? next.lastTurnSubscriber;
		old.lastTurnSubscriber = undefined;
		next.notify("thread/replaced", { oldThreadId: old.id, thread: next.toThread() });
		await this.unload(old.id, reason, next.file, { waitForQueue: false });
		return next;
	}

	private async bind(thread: LoadedThread, mode: "desktop" | "tui"): Promise<void> {
		const { session } = thread;
		await session.bindExtensions({
			mode,
			onError: (error) => {
				console.error(`Extension ${error.extensionPath}: ${error.error}`);
				const warning: Warning = { source: "extension", path: error.extensionPath, message: error.error };
				if (this.threads.get(thread.id) === thread) thread.notify("warning", { ...warning, threadId: thread.id });
				else thread.loadWarnings.push(warning);
			},
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				navigateTree: (targetId, options) => session.navigateTree(targetId, options),
				reload: () => session.reload(),
				newSession: async (options) => {
					const signal = thread.dispatching?.signal;
					if (
						(await this.cancelled(thread, { type: "session_before_switch", reason: "new" }, signal)) ||
						signal?.aborted
					)
						return { cancelled: true };
					const selection = options?.preserveModel
						? { model: session.model, thinking: session.thinkingLevel }
						: undefined;
					const manager = SessionManager.create(
						session.sessionManager.getCwd(),
						liveDirFor(this.ctx, thread.projectCwd),
					);
					if (options?.parentSession) manager.newSession({ parentSession: options.parentSession });
					const next = await this.replace(
						thread,
						() => this.load(manager, mode, "new", thread.approvalMode),
						"new",
						signal,
						options?.withSession !== undefined,
					);
					if (signal?.aborted) return { cancelled: true };
					if (options?.setup) {
						await options.setup(next.session.sessionManager);
						next.session.refreshContext();
					}
					if (signal?.aborted) return { cancelled: true };
					if (selection?.model) {
						// Authentication can wait on the network. Wait here, where a start cancelled meanwhile can still
						// back out, so it cannot overwrite a selection made after the cancel.
						await this.ctx.models.checkAuth(selection.model.provider);
						if (signal?.aborted) return { cancelled: true };
						await next.session.setModel(selection.model);
						next.session.setThinkingLevel(selection.thinking);
					}
					if (signal?.aborted) return { cancelled: true };
					if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
					return { cancelled: false };
				},
				fork: async (entryId, options) => {
					const signal = thread.dispatching?.signal;
					const position = options?.position ?? "before";
					if (
						(await this.cancelled(thread, { type: "session_before_fork", entryId, position }, signal)) ||
						signal?.aborted
					)
						return { cancelled: true };
					const file = thread.file;
					if (!file || !existsSync(file)) throw new Error("This session has not been saved yet.");
					const entry = session.sessionManager.getEntry(entryId);
					if (!entry) throw new Error("Invalid entry ID for forking");
					const leaf =
						position === "at"
							? entry.id
							: entry.type === "message" && entry.message.role === "user"
								? entry.parentId
								: undefined;
					if (leaf === undefined) throw new Error("Invalid entry ID for forking");
					const dir = liveDirFor(this.ctx, thread.projectCwd);
					const cwd = session.sessionManager.getCwd();
					const manager =
						leaf === null ? SessionManager.create(cwd, dir) : SessionManager.forkFrom(file, cwd, dir, { leafId: leaf });
					if (leaf === null) manager.newSession({ parentSession: file });
					const next = await this.replace(
						thread,
						() => this.load(manager, mode, "fork", thread.approvalMode),
						"fork",
						signal,
						options?.withSession !== undefined,
					);
					if (signal?.aborted) return { cancelled: true };
					if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
					return { cancelled: false };
				},
				switchSession: async (sessionPath, options) => {
					const signal = thread.dispatching?.signal;
					const target = resolvePath(sessionPath);
					if (
						(await this.cancelled(
							thread,
							{
								type: "session_before_switch",
								reason: "resume",
								targetSessionFile: target,
							},
							signal,
						)) ||
						signal?.aborted
					)
						return { cancelled: true };
					const id = readSessionHeaderForDiscovery(target)?.id;
					if (!id) throw new Error(`Not a session file: ${sessionPath}`);
					this.files.remember(id, target);
					const next = await this.replace(
						thread,
						() => this.ensureLoaded(id, mode),
						"resume",
						signal,
						options?.withSession !== undefined,
					);
					if (signal?.aborted) return { cancelled: true };
					if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
					return { cancelled: false };
				},
			},
		});
	}

	handlers(): Handlers {
		return {
			"server/diagnostics": async () => this.diagnostics(),
			"file/search": (params) => this.fileSearch.search(params),
			"command/list": async (params) =>
				"threadId" in params
					? { commands: commandsOf(this.get(params.threadId).session) }
					: this.commandsFor(params.cwd),
			"turn/start": async ({ threadId, text, images, requestId, clientMessageId }, connection) =>
				this.startTurn(
					threadId,
					text,
					images && (await Promise.all(images.map(readImageInput))),
					connection,
					requestId,
					clientMessageId,
				),
			"turn/steer": async ({ threadId, expectedTurnId, text, images }) => {
				await this.steer(threadId, expectedTurnId, text, images && (await Promise.all(images.map(readImageInput))));
				return {};
			},
			"turn/queue/add": async ({ threadId, text, images, clientMessageId }, connection) =>
				this.addQueued(
					threadId,
					text,
					images && (await Promise.all(images.map(readImageInput))),
					clientMessageId,
					connection,
				),
			"turn/interrupt": ({ threadId, turnId }) => this.interrupt(threadId, turnId).then(() => ({})),
			"turn/queue/remove": async ({ threadId, queueId }) => ({ removed: this.removeQueued(threadId, queueId) }),
			"thread/compact": ({ threadId, instructions }, connection) =>
				this.ensureLoaded(threadId, connection.mode).then((thread) =>
					thread.exclusive(async () => {
						if (!thread.session.isIdle || thread.session.isSettling || thread.reservedStart)
							throw new AppServerError("turnInProgress", "a turn or replacement preflight is running");
						await thread.session.compact(instructions);
						return {};
					}, false),
				),
			"thread/settings/update": ({ threadId, model, thinkingLevel, approvalMode }, connection) =>
				this.ensureLoaded(threadId, connection.mode).then((thread) =>
					thread.exclusive(async () => {
						if (model) await this.setModel(thread, model.provider, model.id);
						if (thinkingLevel) thread.session.setThinkingLevel(thinkingLevel);
						if (approvalMode) this.setApprovalMode(thread, approvalMode);
						const summary = thread.toThread();
						thread.notify("thread/settings/updated", { thread: summary });
						return { thread: summary };
					}),
				),
			"thread/start": (params, connection) => this.start(params, connection),
			"thread/resume": ({ threadId, cursor }, connection) => this.resume(threadId, cursor, connection),
			"thread/list": (params) => this.list(params),
			"thread/read": ({ threadId, cursor }) => this.read(threadId, cursor),
			"thread/fork": ({ threadId, atItemId }, connection) => this.fork(threadId, atItemId, connection),
			"thread/delete": ({ threadId }) => this.delete(threadId).then(() => ({})),
			"thread/archive": ({ threadId }) => this.archive(threadId, true).then(() => ({})),
			"thread/unarchive": ({ threadId }) => this.archive(threadId, false).then(() => ({})),
			"thread/name/set": ({ threadId, name }, connection) =>
				this.withThread(threadId, connection.mode, (thread) =>
					thread.exclusive(async () => {
						thread.session.setSessionName(name);
						return {};
					}),
				),
			"payload/read": (params) => this.payloads.read(params),
			"thread/unsubscribe": async ({ threadId }, connection) => ({
				status: this.unsubscribe(threadId, connection) ? "unsubscribed" : "notSubscribed",
			}),
		};
	}
}
