/** One shared backend epoch, with reversible preparation and irreversible commit across window mounts. */
import { randomUUID } from "node:crypto";

export interface DesktopActivationBinding {
	owner: string;
	revision: string;
	epoch: string;
	window: string;
	mount: string;
}

export type DesktopCallResult =
	| { status: "ok"; value: unknown }
	| { status: "error"; message: string }
	| { status: "disconnected" }
	| { status: "cancelled" }
	| { status: "outcome-unknown" };

export interface DesktopBackendActivation {
	call(method: string, params: unknown, signal: AbortSignal): Promise<unknown>;
	activate(): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	dispose(): Promise<void>;
}

export interface DesktopWindowParticipant {
	id: string;
	signal: AbortSignal;
	prepare(binding: DesktopActivationBinding, signal: AbortSignal): Promise<void>;
	quiesce(binding: DesktopActivationBinding, signal: AbortSignal): Promise<void>;
	publish(binding: DesktopActivationBinding, signal: AbortSignal): Promise<void>;
	resume(binding: DesktopActivationBinding, signal: AbortSignal): Promise<void>;
	discard(binding: DesktopActivationBinding): Promise<void>;
	revoke(): void;
}

export type DesktopRevisionResult =
	| { status: "committed"; epoch: string; failedWindows: string[] }
	| { status: "retained"; reason: string }
	| { status: "disabled"; reason: string };

type WindowMount = {
	participant: DesktopWindowParticipant;
	mount: string;
	binding?: DesktopActivationBinding;
	lastRequest: number;
	releaseLifetime(): void;
};
type Activation = { revision: string; epoch: string; backend: DesktopBackendActivation };
type Pending = {
	requestId: number;
	window: WindowMount;
	binding: DesktopActivationBinding;
	disconnect(): void;
	cancel(): void;
};

export class DesktopRevisionCoordinator {
	private readonly owner: string;
	private readonly readinessMs: number;
	private readonly drainMs: number;
	private readonly windows = new Map<string, WindowMount>();
	private readonly pending = new Set<Pending>();
	private readonly drained = new Set<() => void>();
	private active?: Activation;
	private disabled = false;
	private phase: "idle" | "preparing" | "quiescing" | "committing" | "disconnected" = "idle";
	private serial: Promise<unknown> = Promise.resolve();
	private transaction?: AbortController;
	private stopping?: Promise<{ status: "retired" } | { status: "disabled"; reason: string }>;

	constructor(owner: string, deadlines: { readinessMs?: number; drainMs?: number } = {}) {
		this.owner = owner;
		this.readinessMs = deadlines.readinessMs ?? 10_000;
		this.drainMs = deadlines.drainMs ?? 5_000;
	}

	/** New or reloaded windows wait for the settled decision; a new mount never inherits old handles. */
	join(participant: DesktopWindowParticipant): Promise<void> {
		const joining = this.serial.then(() => this.joinWindow(participant));
		this.serial = joining.catch(() => {});
		return joining;
	}

	private async joinWindow(participant: DesktopWindowParticipant): Promise<void> {
		if (this.phase === "disconnected" || this.disabled || participant.signal.aborted) return;
		this.leave(participant.id);
		const revoke = () => {
			if (this.windows.get(participant.id)?.participant === participant) this.leave(participant.id);
		};
		const window: WindowMount = {
			participant,
			mount: randomUUID(),
			lastRequest: 0,
			releaseLifetime: () => participant.signal.removeEventListener("abort", revoke),
		};
		this.windows.set(participant.id, window);
		participant.signal.addEventListener("abort", revoke, { once: true });
		const active = this.active;
		if (!active) return;
		const binding = this.identify(active, window);
		const lifetime = new AbortController();
		const signal = AbortSignal.any([lifetime.signal, participant.signal]);
		try {
			await this.deadline(
				(async () => {
					await participant.prepare(binding, signal);
					if (signal.aborted) return;
					await participant.publish(binding, signal);
					if (signal.aborted) return;
					await participant.resume(binding, signal);
				})(),
				this.readinessMs,
				"readiness-timeout",
			);
			if (this.windows.get(participant.id) === window && this.active === active) window.binding = binding;
		} catch {
			lifetime.abort();
			participant.revoke();
			await participant.discard(binding).catch(() => {});
		}
	}

	/** Revoke before announcing a close; admitted backend work remains counted until it actually settles. */
	leave(id: string): void {
		const window = this.windows.get(id);
		if (!window) return;
		window.binding = undefined;
		this.windows.delete(id);
		window.releaseLifetime();
		for (const pending of this.pending) if (pending.window === window) pending.disconnect();
		window.participant.revoke();
	}

	/** Revoke one failed live mount without stopping the shared backend or forgiving admitted work. */
	revoke(binding: DesktopActivationBinding): boolean {
		const window = this.windows.get(binding.window);
		const live = window?.binding;
		if (
			!window ||
			!live ||
			live.owner !== binding.owner ||
			live.revision !== binding.revision ||
			live.epoch !== binding.epoch ||
			live.mount !== binding.mount
		)
			return false;
		window.binding = undefined;
		for (const pending of this.pending) if (pending.window === window) pending.disconnect();
		window.participant.revoke();
		return true;
	}

	/** Bind callers only after both backend readiness and frontend publication have been acknowledged. */
	binding(id: string): DesktopActivationBinding | undefined {
		return this.windows.get(id)?.binding;
	}

	/** Serialize owner updates, including explicit reactivation of identical files with a fresh epoch. */
	update(
		revision: string,
		prepare: (signal: AbortSignal) => Promise<DesktopBackendActivation>,
	): Promise<DesktopRevisionResult> {
		const update = this.serial.then(() => this.switchRevision(revision, prepare));
		this.serial = update.catch(() => {});
		return update;
	}

	/** Events/subscriptions use the same live pair and admission gate as new calls. */
	accepts(binding: DesktopActivationBinding): boolean {
		const live = this.windows.get(binding.window)?.binding;
		return (
			(this.phase === "idle" || this.phase === "preparing") &&
			!!live &&
			!!this.active &&
			binding.owner === this.owner &&
			binding.revision === this.active.revision &&
			binding.epoch === this.active.epoch &&
			binding.mount === live.mount &&
			binding.epoch === live.epoch
		);
	}

	/** Cancellation settles the caller, but counted backend work remains admitted until actual completion. */
	cancel(binding: DesktopActivationBinding, requestId: number): void {
		for (const pending of this.pending) {
			if (
				pending.requestId === requestId &&
				pending.binding.owner === binding.owner &&
				pending.binding.revision === binding.revision &&
				pending.binding.epoch === binding.epoch &&
				pending.binding.window === binding.window &&
				pending.binding.mount === binding.mount
			)
				pending.cancel();
		}
	}

	/** Revoke now, drain real writes, and only then shut down services; failed draining requires restart. */
	shutdown(): Promise<{ status: "retired" } | { status: "disabled"; reason: string }> {
		if (this.stopping) return this.stopping;
		const active = this.active;
		const serial = this.serial;
		this.disconnect();
		this.stopping = (async () => {
			try {
				if (active) await this.deadline(active.backend.pause(), this.readinessMs, "pause-timeout");
				await serial;
				await this.waitForDrain();
				if (active) await this.deadline(active.backend.dispose(), this.readinessMs, "shutdown-timeout");
				this.active = undefined;
				return { status: "retired" };
			} catch (error) {
				return { status: "disabled", reason: message(error) };
			}
		})();
		return this.stopping;
	}

	/** A call is admitted to the exact active pair, never redirected or automatically replayed. */
	async call(
		binding: DesktopActivationBinding,
		requestId: number,
		kind: "read" | "write",
		method: string,
		params: unknown,
	): Promise<DesktopCallResult> {
		const window = this.windows.get(binding.window);
		const live = window?.binding;
		const active = this.active;
		if (!window || !active || !live || !this.accepts(binding) || requestId <= window.lastRequest)
			return { status: "disconnected" };
		window.lastRequest = requestId;
		const lifetime = new AbortController();
		let settle!: (reason: "cancelled" | "disconnected") => void;
		const afterAbort = (): DesktopCallResult => ({
			status:
				kind === "write" ? "outcome-unknown" : lifetime.signal.reason === "cancelled" ? "cancelled" : "disconnected",
		});
		const gone = new Promise<DesktopCallResult>((resolve) => {
			settle = (reason) => {
				lifetime.abort(reason);
				resolve(afterAbort());
			};
		});
		const pending: Pending = {
			requestId,
			binding,
			window,
			disconnect: () => settle("disconnected"),
			cancel: () => settle("cancelled"),
		};
		this.pending.add(pending);
		const work = (async (): Promise<DesktopCallResult> => {
			try {
				const value = await active.backend.call(method, params, lifetime.signal);
				if (window.binding !== live || this.active !== active || lifetime.signal.aborted) return afterAbort();
				return { status: "ok", value };
			} catch (error) {
				return lifetime.signal.aborted ? afterAbort() : { status: "error", message: message(error) };
			} finally {
				this.pending.delete(pending);
				if (!this.pending.size) for (const done of this.drained) done();
			}
		})();
		return Promise.race([work, gone]);
	}

	/** Process loss clears every binding and settles ambiguous writes without pretending they were undone. */
	disconnect(): void {
		this.phase = "disconnected";
		this.transaction?.abort();
		for (const window of this.windows.values()) window.binding = undefined;
		for (const pending of this.pending) pending.disconnect();
		for (const window of this.windows.values()) {
			window.releaseLifetime();
			window.participant.revoke();
		}
		this.windows.clear();
	}

	private async switchRevision(
		revision: string,
		prepare: (signal: AbortSignal) => Promise<DesktopBackendActivation>,
	): Promise<DesktopRevisionResult> {
		if (this.isDisconnected() || this.disabled) return { status: "disabled", reason: "restart-required" };
		const lifetime = new AbortController();
		this.transaction = lifetime;
		const old = this.active;
		const epoch = randomUUID();
		const windows = [...this.windows.values()];
		const candidate = { revision, epoch };
		let backend: DesktopBackendActivation | undefined;
		let committed = false;
		let quiescing = false;
		try {
			this.phase = "preparing";
			await this.deadline(
				(async () => {
					backend = await prepare(lifetime.signal);
					if (lifetime.signal.aborted) {
						await backend.dispose();
						return;
					}
					await Promise.all(
						windows.map((window) => window.participant.prepare(this.identify(candidate, window), lifetime.signal)),
					);
				})(),
				this.readinessMs,
				"readiness-timeout",
			);
			this.assertTransaction(lifetime);
			this.phase = "quiescing";
			quiescing = true;
			await this.deadline(
				Promise.all([
					...(old ? [old.backend.pause()] : []),
					...windows
						.filter((window) => this.windows.get(window.participant.id) === window)
						.map((window) => window.participant.quiesce(this.identify(candidate, window), lifetime.signal)),
				]),
				this.readinessMs,
				"quiesce-timeout",
			);
			await this.waitForDrain();
			this.assertTransaction(lifetime);
			committed = true;
			this.phase = "committing";
			for (const window of windows) {
				window.binding = undefined;
				window.lastRequest = 0;
			}
			if (old) await this.deadline(old.backend.dispose(), this.readinessMs, "shutdown-timeout");
			this.active = { revision, epoch, backend: backend! };
			await this.deadline(backend!.activate(), this.readinessMs, "activation-timeout");
			this.assertTransaction(lifetime);
			const failedWindows: string[] = [];
			await Promise.all(
				windows.map(async (window) => {
					if (this.windows.get(window.participant.id) !== window) return;
					const binding = this.identify(candidate, window);
					const publication = new AbortController();
					const abort = () => publication.abort();
					lifetime.signal.addEventListener("abort", abort, { once: true });
					try {
						await this.deadline(
							(async () => {
								await window.participant.publish(binding, publication.signal);
								if (publication.signal.aborted || this.windows.get(window.participant.id) !== window) return;
								await window.participant.resume(binding, publication.signal);
							})(),
							this.readinessMs,
							"publication-timeout",
						);
						if (!publication.signal.aborted && this.windows.get(window.participant.id) === window)
							window.binding = binding;
					} catch {
						publication.abort();
						failedWindows.push(window.participant.id);
						window.participant.revoke();
					} finally {
						lifetime.signal.removeEventListener("abort", abort);
					}
				}),
			);
			return { status: "committed", epoch, failedWindows };
		} catch (error) {
			lifetime.abort();
			if (backend) await this.deadline(backend.dispose(), this.readinessMs, "cleanup-timeout").catch(() => {});
			if (committed || this.isDisconnected()) return this.disable(message(error));
			try {
				await this.deadline(
					Promise.all(windows.map((window) => window.participant.discard(this.identify(candidate, window)))),
					this.readinessMs,
					"discard-timeout",
				);
				if (quiescing) {
					if (old) await this.deadline(old.backend.resume(), this.readinessMs, "resume-timeout");
					await this.deadline(
						Promise.all(
							windows
								.filter((window) => window.binding)
								.map((window) => window.participant.resume(window.binding!, new AbortController().signal)),
						),
						this.readinessMs,
						"resume-timeout",
					);
				}
				return { status: "retained", reason: message(error) };
			} catch (recoveryError) {
				return this.disable(message(recoveryError));
			}
		} finally {
			this.transaction = undefined;
			if (!this.isDisconnected()) this.phase = "idle";
		}
	}

	private disable(reason: string): DesktopRevisionResult {
		this.disabled = true;
		this.active = undefined;
		for (const window of this.windows.values()) window.binding = undefined;
		for (const pending of this.pending) pending.disconnect();
		for (const window of this.windows.values()) window.participant.revoke();
		return { status: "disabled", reason };
	}

	private isDisconnected(): boolean {
		return this.phase === "disconnected";
	}

	private identify(activation: { revision: string; epoch: string }, window: WindowMount): DesktopActivationBinding {
		return {
			owner: this.owner,
			revision: activation.revision,
			epoch: activation.epoch,
			window: window.participant.id,
			mount: window.mount,
		};
	}

	private assertTransaction(lifetime: AbortController): void {
		if (lifetime.signal.aborted) throw new Error("disconnected");
	}

	private async waitForDrain(): Promise<void> {
		if (!this.pending.size) return;
		let done!: () => void;
		const drained = new Promise<void>((resolve) => {
			done = resolve;
			this.drained.add(done);
		});
		try {
			await this.deadline(drained, this.drainMs, "drain-timeout");
		} finally {
			this.drained.delete(done);
		}
	}

	private async deadline<T>(work: Promise<T>, milliseconds: number, reason: string): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				work,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error(reason)), milliseconds);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
