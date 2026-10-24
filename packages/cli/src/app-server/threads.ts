/**
 * Every live thread in the process (§5). Grows out of the engine's
 * createSessionRegistry (git show 954451f04^:packages/cli/src/engine/sessions.ts):
 * open de-duplication, close order and preflight come from there. The states
 * and the single load path are §5.6.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type {
	ApprovalMode,
	DiffComment,
	ParamsOf,
	ResultOf,
	Thread,
	ThreadSummary,
	Turn,
	WireTurn,
	ImageRef,
	TurnStartResult,
	UiSnapshot,
	Warning,
} from "@knightcode/app-server-protocol";
import { uuidv7 } from "@knightcode/ai";
import type { AgentSession } from "../core/agent-session.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../core/agent-session-services.ts";
import type { InlineExtension } from "../core/extensions/types.ts";
import { getExtensionCacheStats } from "../core/extensions/loader.ts";
import {
	acquireSessionLock,
	type SessionLock,
	SessionHardLinkedError,
	SessionLockedError,
	sessionLockedElsewhere,
} from "../core/session-lock.ts";
import {
	loadEntriesFromFile,
	readSessionHeaderForDiscovery,
	SessionManager,
	type SessionEntry,
	sessionCwdMatches,
} from "../core/session-manager.ts";
import { DEFAULT_TOOL_NAMES, SettingsManager } from "../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { builtInExtensions } from "../extensions/index.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import type { ShellConfig } from "../utils/shell.ts";
import {
	composeReview,
	DEFAULT_DIFF_BUDGETS,
	type DiffBudgets,
	readDiffFile,
	readThreadDiff,
	revertDiff,
	revertHooks,
	TURN_DIFF_ENTRY,
	TurnChanges,
} from "./diff.ts";
import { operationIn, type Repo, repoOf, requireRepo, runGit, withRepoLock } from "./git.ts";
import {
	type GitActionContext,
	gitBranchCreate,
	gitBranches,
	gitBranchSwitch,
	gitCommit,
	gitLog,
	gitPullRequest,
	gitPush,
	gitStage,
	gitOrigin,
	gitStatus,
	gitUnstage,
} from "./git-actions.ts";
import type { AppServerContext } from "./context.ts";
import { AppServerError } from "./errors.ts";
import { positionOf } from "./config.ts";
import { FileSearch } from "./file-search.ts";
import { listFolder, readFile, writeText } from "./files.ts";
import { callAppTool, createMcpAppsExtension, type McpAppsHolder, readAppResource } from "./mcp-apps.ts";
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
import { desktopDialogs } from "./dialogs.ts";
import {
	ARCHIVE_DIR,
	parentIdOf,
	isArchivedPath,
	liveDirFor,
	moveSessionFileWithoutReplace,
	sessionDirs,
	SessionFileIndex,
} from "./session-files.ts";
import {
	allManifests,
	createWorktree,
	type DeleteResult,
	deleteWorktreeLocked,
	handoffChanges,
	inside,
	keptWorktree,
	planHandoff,
	readManifestFile,
	registrationOf,
	restoreWorktreeLocked,
	type Manifest,
	manifestFor,
	placeThread,
	prepareWorktree,
	runCleanup,
	readEnvironments,
	saveEnvironments,
	samePath,
	touchManifest,
	workspaceHooks,
	type WorktreeSettings,
	worktreeSettings,
} from "./workspaces.ts";

/**
 * Unlinks a session file this manager wrote, after closing it: only when its header still names the manager's id,
 * under an exclusive lock as thread/delete takes it. A file another process holds stays.
 */
function removeTranscript(manager: SessionManager): void {
	const file = manager.getSessionFile();
	const id = manager.getSessionId();
	manager.close();
	if (!file || !existsSync(file) || readSessionHeaderForDiscovery(file)?.id !== id) return;
	let lock: SessionLock;
	try {
		lock = acquireSessionLock(file, undefined, true);
	} catch {
		return;
	}
	try {
		if (!lock.lost) unlinkSync(file);
	} finally {
		lock.release();
	}
}

const pathKey = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);

const repoHead = async (repo: Repo) => (await runGit(repo.root, ["rev-parse", "-q", "--verify", "HEAD"])).code === 0;

const sameProject = (a: string, b: string) =>
	samePath(canonicalizePath(resolvePath(a)), canonicalizePath(resolvePath(b)));

/** A new worktree's environment must be one the project defines; a recorded one may since have been removed. */
function requireEnvironment(projectCwd: string, name: string | undefined): void {
	if (name !== undefined && !readEnvironments(projectCwd).some((e) => e.name === name))
		throw new AppServerError("invalidParams", `no environment named "${name}"`);
}

const DEFAULT_IDLE_MS = 10 * 60_000;

/** Test gate only (Global Constraints): awaited between a queued input's dequeue and its start's registration. */
export const queueHooks = { afterDequeue: async () => {} };

type Review = { comments: DiffComment[]; text: string };

export interface ThreadManagerOptions {
	idleMs?: number;
	/** `-e` paths: loaded in every thread as trusted CLI extensions. */
	extensionPaths?: string[];
	/** Inline extensions after the built-ins. Tests load fixtures here. */
	extraExtensions?: InlineExtension[];
	/** Built-ins to leave out, as the terminal's --no-mcp does. */
	disabledBuiltinExtensions?: string[];
	/** The shell environment scripts run in; tests inject one, production uses getShellConfig(). */
	shellConfig?: ShellConfig;
	/** thread/diff/read response budgets; tests shrink them. */
	diffBudgets?: DiffBudgets;
	/** The gh command and leading arguments for git/pr/create; tests point it at a stand-in. */
	ghCommand?: string[];
}

/** `cwd` when it is an existing directory, else invalidParams (as thread/start and command/list refuse one). */
async function existingDirectory(cwd: string): Promise<string> {
	const stats = await stat(resolvePath(cwd)).catch(() => undefined);
	if (!stats?.isDirectory()) throw new AppServerError("invalidParams", `cwd is not a directory: ${cwd}`);
	return cwd;
}

export function defaultApprovalMode(mode: "desktop" | "tui"): ApprovalMode {
	return mode === "desktop" ? "ask" : "fullAccess";
}

// ponytail: a fixed list of built-in commands that do nothing outside the terminal: they open custom() components,
// which the desktop does not draw (Phase C, D6). Replace with command metadata if desktop versions are built.
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
	/** Aborted first thing in closeAll: git and setup processes the manager started stop with it. */
	private readonly shutdown = new AbortController();
	/** Checkout root → the operation holding it: no turn starts and no tool runs there meanwhile (§6.1). */
	private readonly reservedCheckouts = new Map<string, string>();
	/** Thread ids and manifest paths whose worktree is being prepared or restored: fenced against deletion. */
	private readonly preparing = new Set<string>();
	/** Threads with a thread/handoff in progress. */
	private readonly handingOff = new Set<string>();
	/** Queued inputs of a thread whose reload after a handoff failed, kept for its next load. */
	private readonly strandedQueues = new Map<string, LoadedThread["queued"]>();
	/** Manifest path → ids of threads loaded or loading in that worktree. */
	private readonly worktreeUsers = new Map<string, Set<string>>();
	/** Manifest path → the deletion in progress there. */
	private readonly deleting = new Map<string, Promise<DeleteResult | { deleted: false; reason: "inUse" }>>();

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

	private addUser(path: string, id: string): void {
		const key = pathKey(path);
		let users = this.worktreeUsers.get(key);
		if (!users) this.worktreeUsers.set(key, (users = new Set()));
		users.add(id);
	}

	private removeUser(path: string, id: string): void {
		const key = pathKey(path);
		const users = this.worktreeUsers.get(key);
		users?.delete(id);
		if (users?.size === 0) this.worktreeUsers.delete(key);
	}

	/** In use, being prepared or restored, or reserved: never deleted now. */
	private fenced(manifest: Manifest): boolean {
		if (this.preparing.has(manifest.path) || this.preparing.has(manifest.ownerThreadId)) return true;
		if (Object.keys(manifest.placement).some((id) => this.preparing.has(id))) return true;
		if ((this.worktreeUsers.get(pathKey(manifest.path))?.size ?? 0) > 0) return true;
		return [...this.reservedCheckouts.keys()].some((root) => samePath(root, manifest.path));
	}

	/** Ids of the threads that belong to a worktree: its owner, its placements, and every saved thread inside it. */
	private async threadsOf(manifest: Manifest): Promise<{ id: string; archived: boolean; file: string }[]> {
		const ids = new Map<string, { archived: boolean; file: string }>();
		const within = (cwd: string) => inside(manifest.path, canonicalizePath(cwd));
		const live = liveDirFor(this.ctx, manifest.projectCwd);
		for (const [dir, archived] of [
			[live, false],
			[join(live, ARCHIVE_DIR), true],
		] as const) {
			if (!existsSync(dir)) continue;
			for (const session of await listWithIndex(dir))
				if (
					session.messageCount > 0 &&
					(session.id === manifest.ownerThreadId || manifest.placement[session.id] !== undefined || within(session.cwd))
				)
					ids.set(session.id, { archived, file: session.path });
		}
		return [...ids].map(([id, { archived, file }]) => ({ id, archived, file }));
	}

	/**
	 * Delete a managed worktree after its snapshot (§6.1). The fence check, the reservation and the `deleting` entry
	 * happen in one synchronous step, so a load that registered first keeps the worktree and one after it waits.
	 */
	private deleteManaged(
		manifest: Manifest,
		reason: "archive" | "prune" | "user",
		warnings: Warning[],
		by?: Subscriber,
	): Promise<DeleteResult | { deleted: false; reason: "inUse" }> {
		const key = pathKey(manifest.path);
		const running = this.deleting.get(key);
		if (running) return running;
		if (this.fenced(manifest)) return Promise.resolve({ deleted: false, reason: "inUse" });
		this.reservedCheckouts.set(manifest.path, "delete");
		const work = (async () => {
			try {
				await workspaceHooks.afterUserCheck();
				// ponytail: waits for every closing thread, not only those in the worktree; closings are short.
				await Promise.allSettled([...this.closing.values()]);
				// A thread of this worktree open in another process (the terminal beside the desktop app) fences it too.
				if ((await this.threadsOf(manifest)).some((t) => sessionLockedElsewhere(t.file)))
					return { deleted: false, reason: "inUse" } as const;
				const repo = await requireRepo(manifest.mainRoot);
				return await withRepoLock(repo, () =>
					deleteWorktreeLocked({
						settings: this.worktrees(),
						manifest,
						reason,
						trusted: new ProjectTrustStore(this.ctx.agentDir).get(manifest.projectCwd) === true,
						warnings,
						signal: this.shutdown.signal,
						progress: by && ((p) => by.notify("thread/workspace/progress", p)),
						shellConfig: this.options.shellConfig,
					}),
				);
			} finally {
				if (this.reservedCheckouts.get(manifest.path) === "delete") this.reservedCheckouts.delete(manifest.path);
			}
		})();
		this.deleting.set(key, work);
		const clear = () => {
			if (this.deleting.get(key) === work) this.deleting.delete(key);
		};
		void work.then(clear, clear);
		return work;
	}

	private reportWarnings(warnings: Warning[], threadId?: string): void {
		for (const warning of warnings) this.ctx.broadcast("warning", { ...warning, ...(threadId ? { threadId } : {}) });
	}

	/** Past `worktrees.keep`, the least recently used managed worktrees go, each after a snapshot (§6.1). */
	private async prune(): Promise<void> {
		const warnings: Warning[] = [];
		const settings = this.worktrees(warnings);
		if (!settings.autoDelete) return;
		const kept = allManifests(settings)
			.filter((m) => !m.deleted)
			.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
		let count = kept.length;
		for (const manifest of kept) {
			if (count <= settings.keep) break;
			// Only a worktree in use still counts toward `keep`: one that can never go (its project moved, not ours,
			// nested repositories) must not make every prune delete one more healthy worktree in its place.
			try {
				const result = await this.deleteManaged(manifest, "prune", warnings);
				if (result.deleted || result.reason !== "inUse") count--;
			} catch (error) {
				// One worktree whose project moved or whose git failed must not stop the rest; shutdown still does.
				if (this.shutdown.signal.aborted) throw error;
				count--;
				warnings.push({
					source: "server",
					message: `${manifest.path} was not pruned: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}
		this.reportWarnings(warnings);
	}

	private schedulePrune(): void {
		void this.track(() => this.prune()).catch((error: unknown) => {
			if (!(error instanceof AppServerError && error.code === "shuttingDown"))
				console.error(
					`app-server: pruning worktrees failed: ${error instanceof Error ? error.message : String(error)}`,
				);
		});
	}

	/** After an archive: delete the thread's worktree unless another thread still uses it (§6.1). */
	private async archiveWorktree(threadId: string, by?: Subscriber): Promise<ResultOf<"thread/archive">> {
		const file = await this.files.find(threadId);
		const headerCwd = file ? readSessionHeaderForDiscovery(file)?.cwd : undefined;
		const warnings: Warning[] = [];
		const settings = this.worktrees(warnings);
		const manifest = headerCwd ? placeThread(settings, threadId, headerCwd).manifest : undefined;
		if (!manifest) return {};
		if (!settings.autoDelete) return { worktree: { deleted: false, reason: "autoDeleteOff" } };
		if (manifest.deleted && !manifest.deleted.removalFailed)
			return {
				worktree: { deleted: true, ...(manifest.deleted.snapshot ? { snapshot: manifest.deleted.snapshot } : {}) },
			};
		const others = [...(this.worktreeUsers.get(pathKey(manifest.path)) ?? [])].filter((id) => id !== threadId);
		let result: Awaited<ReturnType<typeof this.deleteManaged>>;
		try {
			const saved = (await this.threadsOf(manifest)).filter((t) => t.id !== threadId && !t.archived);
			if (others.length > 0 || saved.length > 0) return { worktree: { deleted: false, reason: "inUse" } };
			result = await this.deleteManaged(manifest, "archive", warnings, by);
		} catch (error) {
			// The thread is archived already: a worktree that could not go is a warning, not a failed archive.
			if (this.shutdown.signal.aborted) throw error;
			warnings.push({
				source: "server",
				message: `${manifest.path} was not deleted: ${error instanceof Error ? error.message : String(error)}`,
			});
			this.reportWarnings(warnings, threadId);
			return { worktree: { deleted: false } };
		}
		this.reportWarnings(warnings, threadId);
		this.schedulePrune();
		if (result.deleted)
			return { worktree: { deleted: true, ...(result.snapshot ? { snapshot: result.snapshot } : {}) } };
		return { worktree: { deleted: false, reason: result.reason } };
	}

	/** `thread/worktree/restore`: rebuild the deleted worktree from its snapshot, then load the thread there. */
	private restore(threadId: string, by: Subscriber): Promise<ResultOf<"thread/worktree/restore">> {
		return this.track(async () => {
			const file = await this.files.find(threadId);
			if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
			const headerCwd = readSessionHeaderForDiscovery(file)?.cwd ?? "";
			const manifest = placeThread(this.worktrees(), threadId, headerCwd).manifest;
			if (!manifest?.deleted) throw new AppServerError("invalidParams", "the worktree of this chat is not deleted");
			await this.restoreManaged(manifest, threadId);
			try {
				const thread = await this.ensureLoaded(threadId, by.mode);
				this.subscribe(thread, by);
				return { thread: thread.toThread() };
			} finally {
				this.preparing.delete(manifest.path);
			}
		});
	}

	/** Rebuilds a deleted worktree; the manifest path stays in `preparing` until the caller loaded its thread. */
	private async restoreManaged(manifest: Manifest, threadId: string): Promise<Manifest> {
		await this.deleting.get(pathKey(manifest.path))?.catch(() => {});
		this.preparing.add(manifest.path);
		try {
			const warnings: Warning[] = [];
			const repo = await requireRepo(manifest.mainRoot);
			const restored = await withRepoLock(repo, () =>
				restoreWorktreeLocked({
					settings: this.worktrees(),
					manifest,
					reason: "user",
					trusted: new ProjectTrustStore(this.ctx.agentDir).get(manifest.projectCwd) === true,
					warnings,
					signal: this.shutdown.signal,
					shellConfig: this.options.shellConfig,
				}),
			);
			this.reportWarnings(warnings, threadId);
			return restored;
		} catch (error) {
			this.preparing.delete(manifest.path);
			throw error;
		}
	}

	/** A turn runs, a start is registered, or a dequeued input is about to register one. */
	private running(thread: LoadedThread): boolean {
		return thread.draining || thread.pendingStarts.size > 0 || !thread.session.isIdle || thread.session.isSettling;
	}

	private reservedFor(thread: LoadedThread): boolean {
		return thread.checkoutRoot !== undefined && this.reservedCheckouts.has(thread.checkoutRoot);
	}

	/** Refuse unless the checkouts are unreserved and no turn runs in them; the threads inside them. */
	private assertCheckoutsFree(held: ReadonlySet<string>): LoadedThread[] {
		for (const root of held)
			if (this.reservedCheckouts.has(root))
				throw new AppServerError("turnInProgress", `the checkout is busy: ${this.reservedCheckouts.get(root)}`);
		const inside = [...this.threads.values()].filter((t) => t.checkoutRoot !== undefined && held.has(t.checkoutRoot));
		if (inside.some((t) => this.running(t)))
			throw new AppServerError("turnInProgress", "a turn is running in this checkout; interrupt it first");
		return inside;
	}

	/**
	 * Take the checkouts for `what`, synchronously with the check that nothing runs in them. Then wait for closing
	 * threads and every in-flight turn snapshot there, so a turn that just completed has its record first.
	 */
	async reserveCheckouts(roots: string[], what: string): Promise<() => void> {
		const held = new Set(roots);
		const inside = this.assertCheckoutsFree(held);
		for (const root of held) this.reservedCheckouts.set(root, what);
		const release = () => {
			for (const root of held) if (this.reservedCheckouts.get(root) === what) this.reservedCheckouts.delete(root);
			for (const thread of this.threads.values())
				if (thread.checkoutRoot !== undefined && held.has(thread.checkoutRoot)) this.afterActivity(thread);
		};
		try {
			// ponytail: waits for every closing thread, not only those in the checkout; closings are short.
			await Promise.allSettled([...this.closing.values()]);
			await Promise.all(inside.map((t) => t.changes?.idle()));
		} catch (error) {
			release();
			throw error;
		}
		return release;
	}

	/** `step` with the checkout reserved and the repository lock held (reservation first, as revert takes them). */
	private async holdingCheckout<T>(repo: Repo, what: string, step: () => Promise<T>): Promise<T> {
		const release = await this.reserveCheckouts([repo.root], what);
		try {
			return await withRepoLock(repo, step);
		} finally {
			release();
		}
	}

	/**
	 * A git or diff request on a thread's checkout: tracked, so shutdown waits for it and a request after shutdown
	 * began answers shuttingDown; the thread is held, never queued behind a turn. `mutates` takes the repository lock.
	 */
	private onCheckout<T>(
		threadId: string,
		mode: "desktop" | "tui",
		mutates: boolean,
		fn: (thread: LoadedThread, repo: Repo, ctx: GitActionContext) => Promise<T>,
	): Promise<T> {
		return this.track(() =>
			this.withThread(threadId, mode, async (thread) => {
				const repo = await requireRepo(thread.session.sessionManager.getCwd(), this.shutdown.signal);
				const ctx = { signal: this.shutdown.signal, models: this.ctx.models, ghCommand: this.options.ghCommand };
				return mutates ? withRepoLock(repo, () => fn(thread, repo, ctx)) : fn(thread, repo, ctx);
			}),
		);
	}

	/**
	 * `thread/handoff` (§6.1) in three phases, so no phase waits on a lock or queue it holds: A prepares the
	 * destination worktree, B moves the changes with both checkouts reserved, C reloads the thread where it now runs.
	 */
	handoff(params: ParamsOf<"thread/handoff">, by: Subscriber): Promise<ResultOf<"thread/handoff">> {
		// One handoff per thread at a time: a second would build a second worktree that the first's leaves orphaned.
		if (this.handingOff.has(params.threadId))
			return Promise.reject(new AppServerError("turnInProgress", "this thread is already being handed off"));
		// A dry run takes nothing, so a real handoff confirmed while one is still answering is not refused.
		if (params.dryRun) return this.track(() => this.checkHandoff(params, by));
		this.handingOff.add(params.threadId);
		return this.track(async () => {
			const { thread, warnings, settings, cwd, headerCwd, placed } = await this.handoffTarget(params, by);
			let manifest = placed.manifest;
			this.preparing.add(thread.id);
			let restored: string | undefined;
			// The worktree this handoff created, until the changes moved into it.
			let fresh: Manifest | undefined;
			let moved = false;
			try {
				// Phase A: a thread born in the main checkout gets its worktree, at the main checkout's HEAD.
				if (manifest?.deleted) {
					manifest = await this.restoreManaged(manifest, thread.id);
					restored = manifest.path;
				}
				if (!manifest) {
					const main = await requireRepo(cwd);
					if (!(await repoHead(main)))
						throw new AppServerError("invalidParams", `commit something in ${main.root} first`);
					// Phase B's cheap refusals first: a handoff refused after this point leaves a worktree behind.
					this.assertCheckoutsFree(new Set([main.root]));
					if (operationIn(main))
						throw new AppServerError(
							"gitConflict",
							`finish the merge, rebase, cherry-pick or revert in ${main.root} first`,
							{ reason: "operationInProgress" },
						);
					const created = await createWorktree({
						settings,
						projectCwd: thread.projectCwd,
						sourceCwd: cwd,
						threadId: thread.id,
						ownerThreadId: thread.id,
						environment: params.environment,
						signal: this.shutdown.signal,
						warnings,
					});
					fresh = created.manifest;
					manifest = await prepareWorktree({
						settings,
						manifest: created.manifest,
						threadId: thread.id,
						trusted: new ProjectTrustStore(this.ctx.agentDir).get(created.manifest.projectCwd) === true,
						warnings,
						signal: this.shutdown.signal,
						progress: (p) => by.notify("thread/workspace/progress", p),
						shellConfig: this.options.shellConfig,
					});
				}
				if (manifest.deleted)
					throw new AppServerError("gitConflict", "the worktree of this chat was deleted", {
						reason: "worktreeDeleted",
						worktree: manifest.path,
						recoveryInstructions: ["The worktree of this chat was deleted. Restore it to continue."],
					});
				const main = await requireRepo(manifest.mainRoot);
				const worktree = await requireRepo(manifest.path);
				// Phase B.
				const release = await this.reserveCheckouts([main.root, worktree.root], "handoff");
				try {
					const bound = manifest;
					const result = await thread.exclusive(() =>
						withRepoLock(main, () =>
							handoffChanges({
								settings,
								manifest: bound,
								threadId: thread.id,
								title: thread.toThread().name,
								to: params.to,
								branch: params.branch,
								bornInWorktree: manifestFor(settings, headerCwd) !== undefined,
								agentDir: this.ctx.agentDir,
								main,
								worktree,
								warnings,
								signal: this.shutdown.signal,
							}),
						),
					);
					moved = true;
					// Phase C, still holding both checkouts: no turn starts in either in between. The changes have moved
					// by now: a failed reload says so, so a client resumes the thread rather than retrying the handoff.
					const next = await this.relocate(thread, by).catch((error: unknown) => {
						const where = placeThread(this.worktrees(), thread.id, headerCwd).cwd;
						const data = {
							...(error instanceof AppServerError && typeof error.data === "object" && error.data !== null
								? error.data
								: {}),
							handedOff: true,
							cwd: where,
							...(result.branch ? { branch: result.branch } : {}),
						};
						const message = `the changes were handed off to ${where}, but the thread did not reload: ${error instanceof Error ? error.message : String(error)}`;
						throw new AppServerError(error instanceof AppServerError ? error.code : "internal", message, data);
					});
					return { thread: next.toThread(), ...(result.branch ? { branch: result.branch } : {}), warnings };
				} finally {
					release();
				}
			} catch (error) {
				// A handoff refused after it created a worktree takes that worktree back (only git and the setup script
				// wrote there), so retries do not stack one per attempt; one git cannot remove is kept and named.
				if (fresh && !moved) {
					// What setup started there (containers, servers) is stopped as a deletion would.
					const freshManifest = fresh;
					await runCleanup({
						manifest: freshManifest,
						threadId: thread.id,
						trusted: new ProjectTrustStore(this.ctx.agentDir).get(freshManifest.projectCwd) === true,
						warnings,
						signal: this.shutdown.signal,
						shellConfig: this.options.shellConfig,
					}).catch((cleanupError: unknown) =>
						warnings.push({
							source: "server",
							message: `The cleanup script failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
						}),
					);
					// Only while it holds no work: a failure after the changes were applied there (a manifest write
					// that failed) leaves them nowhere else but the saved patch.
					const status = await runGit(fresh.path, ["status", "--porcelain", "-z"], { internal: true }).catch(
						() => undefined,
					);
					if (status?.code !== 0 || status.stdout.length > 0) throw keptWorktree(error, fresh);
					const removed = await runGit(fresh.mainRoot, ["worktree", "remove", "--force", fresh.path], {
						internal: true,
					}).catch(() => undefined);
					if (removed?.code !== 0) throw keptWorktree(error, fresh);
					rmSync(dirname(fresh.path), { recursive: true, force: true });
				}
				throw error;
			} finally {
				this.preparing.delete(thread.id);
				if (restored) this.preparing.delete(restored);
			}
		}).finally(() => this.handingOff.delete(params.threadId));
	}

	/** What every handoff checks first: a saved thread, the direction, the environment. */
	private async handoffTarget(params: ParamsOf<"thread/handoff">, by: Subscriber) {
		const thread = await this.ensureLoaded(params.threadId, by.mode);
		if (!thread.file || !existsSync(thread.file))
			throw new AppServerError("invalidParams", "send a message before handing off");
		const warnings: Warning[] = [];
		const settings = this.worktrees(warnings);
		const sessionManager = thread.session.sessionManager;
		const cwd = sessionManager.getCwd();
		const headerCwd = sessionManager.getHeader()?.cwd ?? cwd;
		const placed = placeThread(settings, thread.id, headerCwd);
		if ((params.to === "local") !== (placed.workspace.mode === "worktree"))
			throw new AppServerError(
				"invalidParams",
				`the thread already runs ${params.to === "local" ? "locally" : "in a worktree"}`,
			);
		requireEnvironment(thread.projectCwd, params.environment);
		return { thread, warnings, settings, cwd, headerCwd, placed };
	}

	/**
	 * `thread/handoff` with `dryRun`: every refusal the real call would make before its first write, and nothing
	 * written. A worktree the real call would still create or restore is not there to check: only what does not depend
	 * on it is (a setup script that leaves files behind still fails the real call, after its own checks).
	 */
	private async checkHandoff(params: ParamsOf<"thread/handoff">, by: Subscriber): Promise<ResultOf<"thread/handoff">> {
		const { thread, settings, cwd, placed } = await this.handoffTarget(params, by);
		const manifest = placed.manifest?.deleted ? undefined : placed.manifest;
		const main = await requireRepo(manifest?.mainRoot ?? cwd);
		const worktree = manifest && (await requireRepo(manifest.path));
		this.assertCheckoutsFree(new Set([main.root, ...(worktree ? [worktree.root] : [])]));
		const plan = await planHandoff({
			settings,
			manifest,
			title: thread.toThread().name,
			to: params.to,
			branch: params.branch,
			main,
			worktree,
			signal: this.shutdown.signal,
		});
		return { thread: thread.toThread(), ...(plan.branch ? { branch: plan.branch.target } : {}), warnings: [] };
	}

	/** Reload a thread where its manifest now places it, carrying its queue and subscribers as a replacement does. */
	private async relocate(thread: LoadedThread, by: Subscriber): Promise<LoadedThread> {
		const queued = thread.queued.splice(0);
		const subscribers = [...thread.subscribers];
		const last = thread.lastTurnSubscriber;
		await this.unload(thread.id, "resume", undefined, { waitForQueue: false });
		let next: LoadedThread;
		try {
			next = await this.ensureLoaded(thread.id, by.mode);
		} catch (error) {
			// The old thread is gone and the new one did not load: the inputs wait for the thread's next load.
			this.strandedQueues.set(thread.id, [...(this.strandedQueues.get(thread.id) ?? []), ...queued]);
			throw error;
		}
		for (const subscriber of subscribers) this.subscribe(next, subscriber);
		next.queued.push(...queued);
		next.lastTurnSubscriber = last ?? next.lastTurnSubscriber;
		next.notify("thread/replaced", { oldThreadId: thread.id, thread: next.toThread() });
		this.notifyQueue(next);
		return next;
	}

	/** The text the model reads for an input with review comments; validated before the input is accepted. */
	private async review(threadId: string, mode: "desktop" | "tui", comments: DiffComment[], text: string) {
		const thread = await this.ensureLoaded(threadId, mode);
		const repo = await requireRepo(thread.session.sessionManager.getCwd(), this.shutdown.signal);
		return { prompt: await composeReview(thread, repo, comments, text), review: { comments, text } };
	}

	private worktrees(warnings: Warning[] = []): WorktreeSettings {
		return worktreeSettings(this.ctx.agentDir, warnings);
	}

	/** The project a cwd belongs to: a managed worktree's project, else the cwd itself. */
	private projectOf(cwd: string): string {
		const resolved = resolvePath(cwd);
		return manifestFor(this.worktrees(), resolved)?.projectCwd ?? resolved;
	}

	start(params: ParamsOf<"thread/start">, by: Subscriber): Promise<Commit<ResultOf<"thread/start">>> {
		return this.track(async () => {
			const cwd = resolvePath(params.cwd);
			const stats = await stat(cwd).catch(() => undefined);
			if (!stats?.isDirectory()) throw new AppServerError("invalidParams", `cwd is not a directory: ${params.cwd}`);
			const warnings: Warning[] = [];
			const settings = this.worktrees(warnings);
			// A start inside a managed worktree is a thread of that worktree's project (Codex's "New chat in this worktree").
			const projectCwd = manifestFor(settings, cwd)?.projectCwd ?? cwd;
			const workspace = params.workspace;
			let created: { manifest: Manifest; cwd: string } | undefined;
			let sessionManager: SessionManager;
			let preparingId: string | undefined;
			let thread: LoadedThread;
			try {
				if (workspace?.mode === "worktree") {
					requireEnvironment(projectCwd, workspace.environment);
					const threadId = uuidv7();
					this.preparing.add(threadId);
					preparingId = threadId;
					created = await createWorktree({
						settings,
						projectCwd,
						sourceCwd: cwd,
						threadId,
						ownerThreadId: threadId,
						baseRef: workspace.baseRef,
						carryLocalChanges: workspace.carryLocalChanges,
						environment: workspace.environment,
						signal: this.shutdown.signal,
						warnings,
					});
					try {
						created.manifest = await prepareWorktree({
							settings,
							manifest: created.manifest,
							threadId,
							trusted: new ProjectTrustStore(this.ctx.agentDir).get(created.manifest.projectCwd) === true,
							warnings,
							signal: this.shutdown.signal,
							progress: (params) => by.notify("thread/workspace/progress", params),
							shellConfig: this.options.shellConfig,
						});
					} catch (error) {
						const stopped = this.shutdown.signal.aborted
							? new AppServerError("shuttingDown", "the app server shut down while the worktree was prepared")
							: error;
						throw keptWorktree(stopped, created.manifest);
					}
					sessionManager = SessionManager.create(created.cwd, liveDirFor(this.ctx, projectCwd), { id: threadId });
				} else sessionManager = SessionManager.create(cwd, liveDirFor(this.ctx, projectCwd));
				try {
					thread = await this.load(sessionManager, by.mode, "new", params.approvalMode ?? defaultApprovalMode(by.mode));
				} catch (error) {
					throw created ? keptWorktree(error, created.manifest) : error;
				}
			} finally {
				if (preparingId) this.preparing.delete(preparingId);
			}
			if (created) this.schedulePrune();
			try {
				if (params.model) await this.setModel(thread, params.model.provider, params.model.id);
				if (params.thinkingLevel) thread.session.setThinkingLevel(params.thinkingLevel);
			} catch (error) {
				// A thread the client never got must not stay loaded.
				await this.unload(thread.id);
				throw created ? keptWorktree(error, created.manifest) : error;
			}
			this.subscribe(thread, by);
			const summary = thread.toThread();
			this.ctx.broadcast("thread/started", { thread: summary });
			// `ui` is read as the response is written: a change an extension makes before the send is in it, and
			// one after it arrives as a notification after the response (D2).
			return commitOnSend(() => ({
				thread: summary,
				warnings: [...warnings, ...thread.loadWarnings],
				ui: thread.ui.snapshot(),
			}));
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
			const ui = thread.ui.snapshot();
			const history = this.history(
				summary,
				thread.session.sessionManager.getBranch(),
				cursor,
				thread.mapper?.wireSnapshot(),
				ui,
			);
			this.subscribe(thread, by);
			return {
				thread: summary,
				ui,
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
		ui?: UiSnapshot,
	): HistoryPage {
		return pageHistory({ thread, entries, cursor, runningTurn, ui }, this.payloads);
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
			const settings = this.worktrees();
			const manifests = allManifests(settings);
			let sessions: IndexedSession[] = [];
			const placed = (info: IndexedSession) => {
				const place = placeThread(settings, info.id, info.cwd, manifests);
				return { info, place, projectCwd: place.manifest?.projectCwd ?? info.cwd };
			};
			let entries: ReturnType<typeof placed>[];
			if (params.cwd !== undefined) {
				const requested = resolvePath(params.cwd);
				const cwd = manifestFor(settings, requested)?.projectCwd ?? requested;
				const live = liveDirFor(this.ctx, cwd);
				const dir = archived ? join(live, ARCHIVE_DIR) : live;
				if (existsSync(dir)) sessions = await listWithIndex(dir, { onRead });
				entries = sessions.map(placed);
				// One explicit directory holds every project: keep this project's threads, worktree ones included.
				if (this.ctx.sessionDir !== undefined)
					entries = entries.filter(
						(e) => sessionCwdMatches(e.info.cwd, cwd) || (e.projectCwd !== "" && sameProject(e.projectCwd, cwd)),
					);
			} else {
				// Sequential directories keep the whole listing at at most 64 concurrent scans.
				for (const dir of await sessionDirs(this.ctx, archived))
					sessions.push(...(await listWithIndex(dir, { onRead })));
				entries = sessions.map(placed);
			}
			return entries
				.filter(({ info }) => info.messageCount > 0)
				.sort((a, b) => b.info.modified.getTime() - a.info.modified.getTime())
				.map(({ info, place, projectCwd }): ThreadSummary => {
					const live = this.threads.get(info.id);
					return {
						id: info.id,
						cwd: place.cwd,
						projectCwd,
						name: info.title,
						status: live?.status() ?? this.unloadedStatus(info.id),
						createdAt: info.created.toISOString(),
						forkedFromId: info.forkedFromId,
						archived: isArchivedPath(info.path),
						updatedAt: info.modified.toISOString(),
						workspaceMode: place.workspace.mode,
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
		const place = header?.cwd ? placeThread(this.worktrees(), threadId, header.cwd) : undefined;
		const thread: ThreadSummary = {
			id: threadId,
			cwd: place?.cwd ?? header?.cwd ?? "",
			projectCwd: place?.manifest?.projectCwd ?? header?.cwd ?? "",
			name: titleOf(manager.getSessionName(), firstText),
			status: this.unloadedStatus(threadId),
			createdAt: header?.timestamp ?? "",
			forkedFromId: parentIdOf(header?.parentSession),
			archived: isArchivedPath(file),
			updatedAt: statSync(file).mtime.toISOString(),
			workspaceMode: place?.workspace.mode ?? "local",
		};
		return { thread, ...this.history(thread, entries, cursor) };
	}

	async withThread<T>(threadId: string, mode: "desktop" | "tui", fn: (thread: LoadedThread) => Promise<T>): Promise<T> {
		const thread = await this.ensureLoaded(threadId, mode);
		return thread.hold(() => fn(thread));
	}

	async archive(threadId: string, archived: boolean, by?: Subscriber): Promise<ResultOf<"thread/archive">> {
		this.assertOpen();
		const live = this.threads.get(threadId);
		if (live?.busy) throw new AppServerError("turnInProgress", "interrupt the turn first");
		let changed = false;
		await this.transition(threadId, async (thread) => {
			// Refusals and no-op requests before disposal restore the original ready thread and its subscribers.
			let file: string | undefined;
			try {
				file = await this.files.find(threadId);
				if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
				if (thread?.busy) throw new AppServerError("turnInProgress", "interrupt the turn first");
			} catch (error) {
				if (thread?.state === "ready") this.threads.set(threadId, thread);
				throw error;
			}
			if (isArchivedPath(file) === archived) {
				// An archived thread that is loaded still unloads, so its worktree can go below.
				if (archived && thread) {
					await thread.dispose();
					this.ctx.broadcast("thread/status/changed", { threadId, status: this.unloadedStatus(threadId) });
				} else if (thread?.state === "ready") this.threads.set(threadId, thread);
				return;
			}
			changed = true;
			if (thread) {
				await thread.dispose();
				this.ctx.broadcast("thread/status/changed", { threadId, status: this.unloadedStatus(threadId) });
			}
			const target = archived ? join(dirname(file), ARCHIVE_DIR) : dirname(dirname(file));
			await mkdir(target, { recursive: true });
			const moved = join(target, basename(file));
			await moveSessionFileWithoutReplace(file, moved, threadId, () => this.files.remember(threadId, moved));
		});
		if (changed) this.ctx.broadcast("thread/archived", { threadId, archived });
		// After the closing transition settled, so the deletion never waits on its own entry.
		return archived ? this.archiveWorktree(threadId, by) : {};
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
			// A deleted thread never loads again to take back inputs a failed relocation left.
			this.strandedQueues.delete(threadId);
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

	fork(
		threadId: string,
		atItemId: string | undefined,
		workspace: ParamsOf<"thread/fork">["workspace"],
		by: Subscriber,
	): Promise<Commit<ResultOf<"thread/fork">>> {
		return this.track(async () => {
			const live = this.threads.get(threadId);
			const source = live?.file ?? (await this.files.find(threadId));
			if (!source || !existsSync(source)) throw new AppServerError("threadNotFound", `nothing to fork: ${threadId}`);
			this.assertOpen();
			// A live thread's leaf can move without an append, so its item ids come from the in-memory branch.
			const { entries, manager } = live
				? { entries: live.session.sessionManager.getBranch(), manager: live.session.sessionManager }
				: this.branchOf(source);
			const warnings: Warning[] = [];
			const settings = this.worktrees(warnings);
			const headerCwd = manager.getHeader()?.cwd ?? process.cwd();
			const placed = placeThread(settings, threadId, headerCwd);
			// Where the source runs now (a handed-off source runs in the main checkout) and the project it belongs to.
			const cwd = live?.session.sessionManager.getCwd() ?? placed.cwd;
			const sourceProject = placed.manifest?.projectCwd ?? cwd;
			const dir = liveDirFor(this.ctx, sourceProject);
			// Without atItemId a live thread forks at its in-memory leaf (null after a reset: an empty fork).
			const leafId =
				atItemId === undefined ? live?.session.sessionManager.getLeafId() : entryForItem(entries, atItemId);
			if (atItemId !== undefined && leafId === undefined)
				throw new AppServerError("invalidParams", `no item ${atItemId} in ${threadId}`);
			let created: { manifest: Manifest; cwd: string } | undefined;
			let sessionManager: SessionManager;
			let forkId: string | undefined;
			let thread: LoadedThread;
			try {
				if (workspace?.mode === "worktree") {
					// Codex's "Fork in a new worktree": the source checkout's HEAD, its uncommitted changes carried along.
					const id = uuidv7();
					forkId = id;
					this.preparing.add(id);
					// A source whose worktree was deleted forks from its snapshot (or, without one, its base).
					const gone = placed.workspace.mode === "worktree" && placed.workspace.deleted ? placed.manifest : undefined;
					const inMain = gone && join(gone.mainRoot, relative(gone.path, canonicalizePath(cwd)));
					created = await createWorktree({
						settings,
						projectCwd: sourceProject,
						sourceCwd: gone ? (existsSync(inMain!) ? inMain! : gone.mainRoot) : cwd,
						threadId: id,
						ownerThreadId: id,
						...(gone
							? gone.deleted?.snapshot
								? { snapshot: gone.deleted.snapshot }
								: { baseRef: gone.baseRef }
							: { carryLocalChanges: true }),
						environment: placed.workspace.mode === "worktree" ? placed.workspace.environment : undefined,
						signal: this.shutdown.signal,
						warnings,
					});
					try {
						created.manifest = await prepareWorktree({
							settings,
							manifest: created.manifest,
							threadId: id,
							trusted: new ProjectTrustStore(this.ctx.agentDir).get(created.manifest.projectCwd) === true,
							warnings,
							signal: this.shutdown.signal,
							progress: (params) => by.notify("thread/workspace/progress", params),
							shellConfig: this.options.shellConfig,
						});
						sessionManager = SessionManager.forkFrom(source, created.cwd, dir, { id, leafId });
					} catch (error) {
						throw keptWorktree(error, created.manifest);
					}
				} else
					sessionManager = SessionManager.forkFrom(source, cwd, dir, leafId === undefined ? undefined : { leafId });
				try {
					await workspaceHooks.afterForkFrom();
					thread = await this.load(
						sessionManager,
						by.mode,
						"fork",
						live?.approvalMode ?? readApprovalMode(entries) ?? defaultApprovalMode(by.mode),
					);
					if (thread.state !== "ready")
						throw new AppServerError("threadNotFound", `fork closed while loading: ${thread.id}`);
				} catch (error) {
					// The fork is not returned, so its transcript must not stay behind as a thread nobody asked for.
					removeTranscript(sessionManager);
					throw created ? keptWorktree(error, created.manifest) : error;
				}
			} finally {
				if (forkId) this.preparing.delete(forkId);
			}
			if (created) this.schedulePrune();
			// The copy carries its source's name; mark it so the two can be told apart.
			thread.session.setSessionName(
				`${thread.session.sessionManager.getSessionName() || thread.toThread().name} (fork)`,
			);
			this.subscribe(thread, by);
			const summary = thread.toThread();
			this.ctx.broadcast("thread/started", { thread: summary });
			// `ui` is read as the response is written: a change an extension makes before the send is in it, and
			// one after it arrives as a notification after the response (D2).
			return commitOnSend(() => ({
				thread: summary,
				warnings: [...warnings, ...thread.loadWarnings],
				ui: thread.ui.snapshot(),
			}));
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
		const headerCwd = readSessionHeaderForDiscovery(file)?.cwd;
		const placed = headerCwd ? placeThread(this.worktrees(), threadId, headerCwd) : undefined;
		if (placed?.workspace.mode === "worktree" && placed.workspace.deleted)
			throw new AppServerError("gitConflict", "the worktree of this chat was deleted", {
				reason: "worktreeDeleted",
				worktree: placed.workspace.path,
				recoveryInstructions: ["The worktree of this chat was deleted. Restore it to continue."],
			});
		let sessionManager: SessionManager;
		try {
			// A handed-off thread runs where its manifest places it; its header keeps the cwd it was born in.
			sessionManager = SessionManager.open(file, undefined, placed?.manifest ? placed.cwd : undefined);
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
		this.shutdown.abort();
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
		// A thread running in a managed worktree registers before its first await (§6.1 deletion fence).
		const placed = placeThread(
			this.worktrees(),
			sessionManager.getSessionId(),
			sessionManager.getHeader()?.cwd ?? sessionManager.getCwd(),
		);
		const worktree = placed.workspace.mode === "worktree" ? placed.manifest?.path : undefined;
		if (worktree) this.addUser(worktree, sessionManager.getSessionId());
		const building = this.track(async () => {
			if (worktree) {
				try {
					await this.deleting.get(pathKey(worktree))?.catch(() => {});
					if (readManifestFile(worktree)?.deleted)
						throw new AppServerError("gitConflict", "the worktree of this chat was deleted", {
							reason: "worktreeDeleted",
							worktree,
							recoveryInstructions: ["The worktree of this chat was deleted. Restore it to continue."],
						});
				} catch (error) {
					sessionManager.close();
					throw error;
				}
			}
			const thread = await this.build(sessionManager, mode, reason, approvalMode);
			if (worktree) thread.onClosed = () => this.removeUser(worktree, thread.id);
			return thread;
		}).catch((error: unknown) => {
			if (worktree) this.removeUser(worktree, sessionManager.getSessionId());
			if (error instanceof AppServerError && error.code === "shuttingDown") sessionManager.close();
			throw error;
		});
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
		const settings = this.worktrees();
		const id = sessionManager.getSessionId();
		const headerCwd = sessionManager.getHeader()?.cwd ?? cwd;
		const projectCwd = placeThread(settings, id, headerCwd).manifest?.projectCwd ?? cwd;
		let created: LoadedThread | undefined;
		let services: Awaited<ReturnType<typeof createAgentSessionServices>> | undefined;
		let session: AgentSession | undefined;
		try {
			const holder: { thread?: LoadedThread } & McpAppsHolder = {};
			services = await this.servicesFor(cwd, projectCwd, holder);
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
				projectCwd,
				effective,
				() => this.afterActivity(thread),
				this.payloads,
				this.ctx.broadcast,
				parentIdOf(sessionManager.getHeader()?.parentSession),
			);
			created = thread;
			holder.thread = thread;
			// The bus as the latest load of the session's extensions left it (a /reload loads them again).
			thread.mcpApps = () => holder.mcpApps;
			thread.resolveWorkspace = () => placeThread(settings, id, headerCwd).workspace;
			touchManifest(settings, cwd);
			const repo = await repoOf(cwd);
			thread.checkoutRoot = repo?.root;
			if (repo)
				thread.changes = new TurnChanges(
					repo,
					(record) => {
						try {
							thread.session.sessionManager.appendCustomEntry(TURN_DIFF_ENTRY, record);
						} catch (error) {
							console.error(`app-server: could not record the changes of turn ${record.turnId}: ${String(error)}`);
						}
					},
					({ turnId, files }) => thread.notify("turn/diff/updated", { threadId: thread.id, turnId, files }),
				);
			await this.bind(thread, mode);
			thread.mapper = new ItemMapper(
				thread,
				(method, params) => this.ctx.broadcast(method, params),
				(turnId) => this.afterSettle(thread, turnId),
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
			if (hasTrustRequiringProjectResources(cwd) && new ProjectTrustStore(this.ctx.agentDir).get(projectCwd) === null)
				thread.loadWarnings.push({
					source: "trust",
					message:
						"This project has its own extensions and settings; they were not loaded. Trust the project to use them.",
				});
			// A shutdown that began during the load must not leave this thread behind.
			this.assertOpen();
			this.threads.set(thread.id, thread);
			// Inputs a failed relocation left without a thread come back in its queue (they run at its next idle).
			const stranded = this.strandedQueues.get(thread.id);
			if (stranded) {
				this.strandedQueues.delete(thread.id);
				thread.queued.push(...stranded);
				// Once the caller has subscribed: announce them, and the oldest starts as on an idle thread.
				setImmediate(() => {
					this.notifyQueue(thread);
					this.afterActivity(thread);
				});
			}
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
	private servicesFor(cwd: string, projectCwd: string, holder: { thread?: LoadedThread } & McpAppsHolder) {
		// A worktree's trust is its project's: keyed by the worktree path, every new worktree would ask again (§6.1).
		const projectTrusted =
			!hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(this.ctx.agentDir).get(projectCwd) === true;
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
	 * What a new thread in a project would offer, before it has one: an in-memory session that is never
	 * bound, so no extension starts and nothing is written. Extensions register commands and tools as they load.
	 */
	private probe<T>(cwdParam: string, read: (session: AgentSession) => T): Promise<T> {
		return this.track(async () => {
			const cwd = resolvePath(cwdParam);
			const stats = await stat(cwd).catch(() => undefined);
			if (!stats?.isDirectory()) throw new AppServerError("invalidParams", `cwd is not a directory: ${cwdParam}`);
			const services = await this.servicesFor(cwd, manifestFor(this.worktrees(), cwd)?.projectCwd ?? cwd, {});
			let session: AgentSession | undefined;
			try {
				({ session } = await createAgentSessionFromServices({
					services,
					sessionManager: SessionManager.inMemory(cwd),
				}));
				return read(session);
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
	private threadExtensions(holder: { thread?: LoadedThread } & McpAppsHolder): InlineExtension[] {
		return [
			createMcpAppsExtension(holder),
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
			// After the approval gate, so a declined call never snapshots.
			{
				name: "app-server-turn-changes",
				hidden: true,
				factory: (knightcode) => {
					knightcode.on("tool_call", async () => {
						const thread = holder.thread;
						// Also covers runs an extension launches without turn/start.
						if (thread && this.reservedFor(thread))
							return {
								block: true,
								reason: "the checkout is being reverted, handed off or deleted; try again when it finishes",
							};
						await thread?.changes?.beforeTool();
						return undefined;
					});
				},
			},
		];
	}

	private afterSettle(thread: LoadedThread, turnId?: string): void {
		thread.changes?.settled(turnId);
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
		touchManifest(this.worktrees(), thread.session.sessionManager.getCwd());
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
		// A reserved checkout keeps the input queued; the release runs afterActivity, which drains it then.
		if (this.reservedFor(thread)) return;
		const next = thread.queued.shift();
		if (!next) return;
		thread.draining = true;
		this.notifyQueue(thread);
		void queueHooks
			.afterDequeue()
			.then(() =>
				this.startTurn(thread.id, next.text, next.images, next.by, undefined, next.clientMessageId, next.review),
			)
			.catch((error: unknown) => {
				// Dropped, not retried: a start that failed (no model, signed out) would fail again in a loop.
				thread.notify("error", {
					threadId: thread.id,
					message: `A queued message could not start: ${error instanceof Error ? error.message : String(error)}`,
					...(next.clientMessageId ? { clientMessageId: next.clientMessageId } : {}),
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
		review?: Review,
	): Promise<{ queueId: string }> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		this.subscribe(thread, by);
		const queueId = randomUUID();
		thread.queued.push({ id: queueId, text, images, clientMessageId, review, by });
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
		review?: Review,
	): Promise<TurnStartResult> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		this.subscribe(thread, by);
		if (this.reservedFor(thread))
			throw new AppServerError("turnInProgress", "the checkout is being reverted, handed off or deleted");
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
					if (this.reservedFor(thread))
						throw new AppServerError("turnInProgress", "the checkout is being reverted, handed off or deleted");
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
					thread.pendingReview = review;
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
					owner.pendingReview = undefined;
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
		if (!thread) return;
		if (turnId !== undefined && thread.mapper.currentTurnId() !== turnId)
			throw new AppServerError("turnMismatch", "the owning turn changed");
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
					next.pendingReview = old.pendingReview;
					old.pendingTurnRequestId = undefined;
					old.pendingClientMessageId = undefined;
					old.pendingReview = undefined;
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
			// The terminal's own dialogs reach its threads through local handles (§7.3), not yet built.
			...(mode === "desktop" ? { uiContext: desktopDialogs(thread) } : {}),
			onError: (error) => {
				console.error(`Extension ${error.extensionPath}: ${error.error}`);
				const warning: Warning = { source: "extension", path: error.extensionPath, message: error.error };
				if (this.threads.get(thread.id) === thread) thread.notify("warning", { ...warning, threadId: thread.id });
				else thread.loadWarnings.push(warning);
			},
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				navigateTree: (targetId, options) => session.navigateTree(targetId, options),
				reload: async () => {
					// The old runner is invalidated early in reload (agent-session.ts:3898) and settings and resources
					// load after it, so a press in between must not reach its handlers: they are dropped at once.
					thread.ui.handlers.clear();
					try {
						// After the outgoing extensions' session_shutdown, before the new ones' session_start (D16).
						await session.reload({ beforeSessionStart: () => thread.ui.clear(thread) });
					} catch (error) {
						// A failed reload never reaches beforeSessionStart; the old extensions are gone, so is their UI.
						thread.ui.clear(thread);
						throw error;
					}
				},
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
						// Setup writes to the manager, which emits no session_info_changed for a name it gives the session.
						const name = next.session.sessionManager.getSessionName();
						if (name) this.ctx.broadcast("thread/name/updated", { threadId: next.id, name });
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
					: this.probe(params.cwd, (session) => ({ commands: commandsOf(session) })),
			// Without a project, the agent directory stands in: it has no `.knightcode` of its own.
			"tool/list": async ({ cwd }) => {
				// The defaults from the probe's own settings: a trusted project's override counts.
				return this.probe(cwd ?? this.ctx.agentDir, (session) => ({
					tools: session
						.getAllTools()
						.filter((tool) => tool.exposure !== "hidden")
						.map((tool) => ({ name: tool.name, description: tool.description, source: tool.sourceInfo.source })),
					defaultTools: session.settingsManager.getDefaultTools() ?? [...DEFAULT_TOOL_NAMES],
				}));
			},
			"turn/start": async ({ threadId, text, images, requestId, clientMessageId, comments }, connection) => {
				const reviewed = comments ? await this.review(threadId, connection.mode, comments, text) : undefined;
				return this.startTurn(
					threadId,
					reviewed?.prompt ?? text,
					images && (await Promise.all(images.map(readImageInput))),
					connection,
					requestId,
					clientMessageId,
					reviewed?.review,
				);
			},
			"turn/steer": async ({ threadId, expectedTurnId, text, images }) => {
				await this.steer(threadId, expectedTurnId, text, images && (await Promise.all(images.map(readImageInput))));
				return {};
			},
			"turn/queue/add": async ({ threadId, text, images, clientMessageId, comments }, connection) => {
				const reviewed = comments ? await this.review(threadId, connection.mode, comments, text) : undefined;
				return this.addQueued(
					threadId,
					reviewed?.prompt ?? text,
					images && (await Promise.all(images.map(readImageInput))),
					clientMessageId,
					connection,
					reviewed?.review,
				);
			},
			"thread/diff/revert": (params, connection) =>
				this.track(() =>
					this.ensureLoaded(params.threadId, connection.mode).then(async (thread) => {
						const repo = await requireRepo(thread.session.sessionManager.getCwd(), this.shutdown.signal);
						const release = await this.reserveCheckouts([repo.root], "revert");
						try {
							await revertHooks.afterReserve();
							return await thread.exclusive(() => withRepoLock(repo, () => revertDiff(thread, repo, params)));
						} finally {
							release();
						}
					}),
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
			"thread/handoff": (params, connection) => this.handoff(params, connection),
			"thread/diff/read": (params, connection) =>
				this.onCheckout(params.threadId, connection.mode, false, (thread, repo, ctx) =>
					readThreadDiff(thread, repo, params, this.options.diffBudgets ?? DEFAULT_DIFF_BUDGETS, ctx.signal),
				),
			"thread/diff/file": (params, connection) =>
				this.onCheckout(params.threadId, connection.mode, false, (_thread, repo) => readDiffFile(repo, params)),
			"file/read": ({ threadId, path, maxBytes }, connection) =>
				this.track(() =>
					this.withThread(threadId, connection.mode, (thread) =>
						readFile(thread.session.sessionManager.getCwd(), path, maxBytes),
					),
				),
			"file/list": ({ threadId, path }, connection) =>
				this.track(() =>
					this.withThread(threadId, connection.mode, (thread) =>
						listFolder(thread.session.sessionManager.getCwd(), path),
					),
				),
			"file/write": ({ threadId, path, text, expectedMtimeMs }, connection) =>
				this.track(() =>
					this.withThread(threadId, connection.mode, (thread) =>
						writeText(thread.session.sessionManager.getCwd(), path, text, expectedMtimeMs),
					),
				),
			"mcp/app/readResource": (params, connection) =>
				this.track(() =>
					this.withThread(params.threadId, connection.mode, (thread) => readAppResource(thread.mcpApps(), params)),
				),
			"mcp/app/callTool": (params, connection) =>
				this.track(() =>
					this.withThread(params.threadId, connection.mode, (thread) =>
						callAppTool(thread.mcpApps(), thread.approvalMode, params),
					),
				),
			"git/status": ({ threadId }, connection) =>
				this.onCheckout(threadId, connection.mode, false, (_thread, repo) => gitStatus(repo)),
			"git/origin": ({ threadId }, connection) =>
				this.onCheckout(threadId, connection.mode, false, (_thread, repo) => gitOrigin(repo)),
			// Index changes hold the checkout, as a revert does: no turn runs (a tool may be halfway through a file) and none
			// starts until the git step is done. The reservation comes before the repository lock, in the revert's order.
			"git/stage": (params, connection) =>
				this.onCheckout(params.threadId, connection.mode, false, (thread, repo) =>
					this.holdingCheckout(repo, "stage", () => gitStage(thread, repo, params)),
				),
			"git/unstage": (params, connection) =>
				this.onCheckout(params.threadId, connection.mode, false, (thread, repo) =>
					this.holdingCheckout(repo, "unstage", () => gitUnstage(thread, repo, params)),
				),
			// gitCommit holds the checkout for its staging step only, never across the model call writing the message.
			"git/commit": (params, connection) =>
				this.onCheckout(params.threadId, connection.mode, false, (thread, repo, ctx) =>
					gitCommit(thread, repo, params, ctx, (step) => this.holdingCheckout(repo, "commit", step)),
				),
			// No repository lock across the network: a push touches neither the index nor the working tree.
			"git/push": ({ threadId }, connection) =>
				this.onCheckout(threadId, connection.mode, false, (_thread, repo, ctx) => gitPush(repo, ctx)),
			"git/pr/create": (params, connection) =>
				this.onCheckout(params.threadId, connection.mode, false, (_thread, repo, ctx) =>
					gitPullRequest(repo, params, ctx),
				),
			"git/branches": async (params, connection) =>
				"threadId" in params
					? this.onCheckout(params.threadId, connection.mode, false, (_thread, repo) => gitBranches(repo))
					: this.track(async () => gitBranches(await requireRepo(resolvePath(params.cwd), this.shutdown.signal))),
			// A new branch moves HEAD: a running turn's later commits would land on it.
			"git/branch/create": ({ threadId, name }, connection) =>
				this.onCheckout(threadId, connection.mode, false, (_thread, repo) =>
					this.holdingCheckout(repo, "branch create", () => gitBranchCreate(repo, name)),
				),
			// A switch rewrites the working tree: never under a running turn, whose diff would take the switch's files.
			"git/branch/switch": ({ threadId, name }, connection) =>
				this.track(() =>
					this.ensureLoaded(threadId, connection.mode).then(async (thread) => {
						const repo = await requireRepo(thread.session.sessionManager.getCwd(), this.shutdown.signal);
						const release = await this.reserveCheckouts([repo.root], "branch switch");
						try {
							return await withRepoLock(repo, () => gitBranchSwitch(repo, name));
						} finally {
							release();
						}
					}),
				),
			"git/log": ({ threadId, limit }, connection) =>
				this.onCheckout(threadId, connection.mode, false, (thread, repo) => gitLog(thread, repo, limit ?? 50)),
			"environment/list": async ({ cwd }) => {
				this.assertOpen();
				const projectCwd = this.projectOf(await existingDirectory(cwd));
				return {
					environments: readEnvironments(projectCwd),
					trusted: new ProjectTrustStore(this.ctx.agentDir).get(projectCwd) === true,
				};
			},
			// A project that exists: a made-up cwd must not get a .knightcode directory created for it.
			"environment/save": ({ cwd, environments }) =>
				this.track(async () => {
					saveEnvironments(this.projectOf(await existingDirectory(cwd)), environments);
					return {};
				}),
			"thread/resume": ({ threadId, cursor }, connection) => this.resume(threadId, cursor, connection),
			"thread/list": (params) => this.list(params),
			"thread/read": ({ threadId, cursor }) => this.read(threadId, cursor),
			"thread/fork": ({ threadId, atItemId, workspace }, connection) =>
				this.fork(threadId, atItemId, workspace, connection),
			"thread/delete": ({ threadId }) => this.delete(threadId).then(() => ({})),
			"thread/archive": ({ threadId }, connection) => this.track(() => this.archive(threadId, true, connection)),
			"thread/worktree/restore": ({ threadId }, connection) => this.restore(threadId, connection),
			"worktree/list": async ({ cwd }) => {
				const settings = this.worktrees();
				const project = cwd === undefined ? undefined : this.projectOf(cwd);
				const worktrees: ResultOf<"worktree/list">["worktrees"] = [];
				for (const manifest of allManifests(settings)) {
					if (project !== undefined && !sameProject(manifest.projectCwd, project)) continue;
					const registration = manifest.deleted ? undefined : await registrationOf(manifest);
					const ours = registration?.status === "ours" ? registration : undefined;
					worktrees.push({
						path: manifest.path,
						projectCwd: manifest.projectCwd,
						...(ours?.head ? { head: ours.head } : {}),
						...(ours?.branch ? { branch: ours.branch } : {}),
						threadIds: (await this.threadsOf(manifest)).map((t) => t.id),
						lastUsedAt: manifest.lastUsedAt,
						deleted: manifest.deleted !== undefined,
					});
				}
				return { worktrees };
			},
			"worktree/delete": ({ path }, connection) =>
				this.track(async () => {
					const manifest = manifestFor(this.worktrees(), resolvePath(path));
					if (!manifest || !samePath(manifest.path, canonicalizePath(resolvePath(path))))
						throw new AppServerError("invalidParams", `not a managed worktree: ${path}`);
					const warnings: Warning[] = [];
					const result = await this.deleteManaged(manifest, "user", warnings, connection);
					this.reportWarnings(warnings);
					if (result.deleted) return result.snapshot ? { snapshot: result.snapshot } : {};
					if (result.reason === "inUse")
						throw new AppServerError("gitConflict", "a chat is using this worktree", { reason: "worktreeInUse" });
					if (result.reason === "submodules")
						throw new AppServerError(
							"gitConflict",
							"Remove or commit the nested repositories' work, then delete the worktree.",
							{ reason: "submodules", paths: result.paths },
						);
					throw new AppServerError("invalidParams", `${path} is not this project's managed worktree`);
				}),
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
			// An unloaded thread has no widgets to press: `get` answers threadNotFound, also while it closes (every
			// close takes it out of `threads` first), so a closing session's handlers hear nothing.
			"ui/event": async ({ threadId, ...event }) => {
				const thread = this.get(threadId);
				thread.ui.dispatch(thread, event);
				return {};
			},
		};
	}
}
