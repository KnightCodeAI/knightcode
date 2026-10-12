/** One live thread: its session, subscribers, approval state, lifecycle state and operation queue (§5.1, §5.6). */

import type { ApprovalMode, NotificationMethod, NotificationParams, Thread } from "@knightcode/app-server-protocol";
import type { AgentSession } from "../core/agent-session.ts";
import { emitSessionShutdownEvent } from "../core/extensions/runner.ts";
import { AppServerError, SubscriberGone } from "./errors.ts";
import type { ItemMapper } from "./item-mapper.ts";
import type { PayloadStore } from "./payloads.ts";
import type { Subscriber } from "./server.ts";
import { isArchivedPath } from "./session-files.ts";

const TITLE_LENGTH = 200;

export function titleOf(name: string | undefined, firstMessage: string): string {
	const source = name || firstMessage.split("\n", 1)[0].trim();
	let title = "";
	let previous = "";
	let count = 0;
	for (const point of source) {
		if (count === TITLE_LENGTH) return `${previous}…`;
		previous = title;
		title += point;
		count++;
	}
	return title;
}

export class LoadedThread {
	readonly id: string;
	readonly payloads: PayloadStore;
	mapper!: ItemMapper;
	pendingTurnRequestId?: string;
	/** Admission completes only after the mapper created a durable turn identity. */
	acceptTurnStart?: () => void;
	private reservation?: AbortController;
	private readonly reservationWaiters = new Set<() => void>();

	get reservedStart(): AbortController | undefined {
		return this.reservation;
	}
	set reservedStart(value: AbortController | undefined) {
		this.reservation = value;
		if (value !== undefined) return;
		for (const wake of this.reservationWaiters) wake();
		this.reservationWaiters.clear();
	}
	readonly session: AgentSession;
	readonly projectCwd: string;
	readonly subscribers = new Set<Subscriber>();
	lastTurnSubscriber: Subscriber | undefined;
	approvalMode: ApprovalMode;
	readonly allowed = new Set<string>();
	/** Abort controllers of server requests in flight for this thread. */
	readonly pending = new Set<AbortController>();
	/**
	 * Each open server request's current attempt and the subscriber it went to (Task 12). Unsubscribing or
	 * disconnecting that subscriber withdraws the attempt, so the request moves on (§4.5).
	 */
	readonly asks = new Set<{ target: Subscriber; controller: AbortController }>();
	/** ready → closing → closed. A closing thread takes no new work. */
	state: "ready" | "closing" | "closed" = "ready";
	idleTimer: ReturnType<typeof setTimeout> | undefined;
	unsubscribeSession: () => void = () => {};
	/** turn/starts not yet launched (Task 11), from before they queue. turn/interrupt and dispose abort them all. */
	readonly pendingStarts = new Set<AbortController>();
	/** Requests holding the thread: queued or running operations, one-off changes. */
	private ops = 0;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly onActivityEnd: () => void;

	constructor(
		session: AgentSession,
		projectCwd: string,
		approvalMode: ApprovalMode,
		onActivityEnd: () => void,
		payloads: PayloadStore,
	) {
		this.payloads = payloads;
		this.id = session.sessionManager.getSessionId();
		this.session = session;
		this.projectCwd = projectCwd;
		this.approvalMode = approvalMode;
		this.onActivityEnd = onActivityEnd;
	}

	get file(): string | undefined {
		return this.session.sessionManager.getSessionFile();
	}

	/** Busy threads are never unloaded by the idle timer: a request holds them, or a run or compaction is going. */
	get busy(): boolean {
		return this.ops > 0 || this.pendingStarts.size > 0 || !this.session.isIdle || this.session.isSettling;
	}

	/** Count `fn` as activity, so the idle timer leaves the thread alone until it ends. */
	async hold<T>(fn: () => Promise<T>): Promise<T> {
		this.ops++;
		try {
			return await fn();
		} finally {
			this.ops--;
			this.onActivityEnd();
		}
	}

	/** Run `fn` after every earlier exclusive operation on this thread (§5.6). */
	exclusive<T>(fn: () => Promise<T>, waitForReservation = true): Promise<T> {
		const run = this.queue.then(async () => {
			while (waitForReservation && this.reservedStart && this.state === "ready")
				await new Promise<void>((resolve) => this.reservationWaiters.add(resolve));
			if (this.state !== "ready") throw new AppServerError("threadNotFound", `thread is closing: ${this.id}`);
			return fn();
		});
		this.queue = run.catch(() => {});
		return this.hold(() => run);
	}

	toThread(): Thread {
		const { session } = this;
		const model = session.model;
		const firstUser = session.messages.find((m) => m.role === "user");
		const firstText =
			firstUser && Array.isArray(firstUser.content)
				? firstUser.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ")
				: typeof firstUser?.content === "string"
					? firstUser.content
					: "";
		return {
			id: this.id,
			cwd: session.sessionManager.getCwd(),
			projectCwd: this.projectCwd,
			name: titleOf(session.sessionManager.getSessionName(), firstText),
			status: session.isIdle && !session.isSettling ? "idle" : "active",
			archived: this.file !== undefined && isArchivedPath(this.file),
			updatedAt:
				session.sessionManager.getLeafEntry()?.timestamp ?? session.sessionManager.getHeader()?.timestamp ?? "",
			workspace: { mode: "local" },
			approvalMode: this.approvalMode,
			...(model
				? { model: { provider: model.provider, id: model.id, name: model.name, contextWindow: model.contextWindow } }
				: {}),
			thinkingLevel: session.thinkingLevel,
		};
	}

	notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void {
		for (const subscriber of this.subscribers) subscriber.notify(method, params);
	}

	abortPending(): void {
		for (const controller of [...this.pending]) controller.abort(new Error("Tool call cancelled"));
		this.pending.clear();
	}

	/** `subscriber` left: every request attempt that went to it fails as a disconnect would, and moves on. */
	withdrawFrom(subscriber: Subscriber): void {
		for (const ask of [...this.asks]) {
			if (ask.target === subscriber) ask.controller.abort(new SubscriberGone());
		}
	}

	/** Resolves when every operation queued so far has ended. The queue promise never rejects. */
	drain(): Promise<void> {
		return this.queue.then(() => {});
	}

	/**
	 * The engine's close order (sessions.ts:325-339), with cancellation first so the queue drains fast:
	 * a pending turn/start stops before launching, pending approvals resolve as cancelled, a run or
	 * compaction aborts and settles (the mapper still sees agent_settled, so subscribers get
	 * turn/completed). Then the queue drains, extensions hear session_shutdown, and the session is
	 * disposed, which closes the manager and releases the lock (Task 2). Operations queued but not
	 * started fail fast: `exclusive` refuses a thread that is not ready.
	 *
	 * `waitForQueue: false` is for a replacement: its caller is a command running on this queue.
	 */
	async dispose(
		reason: "quit" | "new" | "resume" | "fork" = "quit",
		targetSessionFile?: string,
		waitForQueue = true,
	): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closing";
		clearTimeout(this.idleTimer);
		for (const start of this.pendingStarts) start.abort();
		this.reservedStart = undefined;
		this.abortPending();
		try {
			await this.session.abort();
			if (waitForQueue) await this.drain();
		} finally {
			// A gated settlement hook can outlive abort() while the runtime already reports idle.
			// Finish the mapped turn before detaching, so accepted starts keep their completion obligation.
			if (this.mapper?.currentTurnId()) this.mapper.settled(true);
			this.unsubscribeSession();
			await emitSessionShutdownEvent(this.session.extensionRunner, {
				type: "session_shutdown",
				reason,
				targetSessionFile,
			});
			this.session.dispose();
			this.state = "closed";
		}
	}
}
