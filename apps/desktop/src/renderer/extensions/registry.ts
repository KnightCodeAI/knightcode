/** Window-local, atomic contribution sets and their owned lifetimes. Built-ins use this same path. */
import type {
	experimental_Command,
	experimental_CommandContext,
	experimental_DesktopApp,
	experimental_DesktopExtension,
	experimental_Disposable,
	experimental_Surface,
	experimental_SurfaceContribution,
} from "@knightcodeai/cli/desktop";

export type Registration = {
	id: string;
	owner: string;
	revision?: string;
	sequence: number;
	signal: AbortSignal;
	reportError(error: unknown): void;
} & (
	| { kind: "command"; contribution: experimental_Command }
	| { kind: "slot" | "provider"; contribution: experimental_SurfaceContribution }
);

export type CommandRegistration = Extract<Registration, { kind: "command" }>;
export type SurfaceRegistration = Extract<Registration, { kind: "slot" | "provider" }>;

export class ExtensionRegistry {
	private entries: readonly Registration[] = [];
	private owners = new Map<string, () => void>();
	private preparing = new Set<string>();
	private listeners = new Set<() => void>();
	private sequence = 0;
	private report: (owner: string, error: unknown, revision?: string) => void;

	constructor(
		report: (owner: string, error: unknown, revision?: string) => void = (owner, error) => console.error(owner, error),
	) {
		this.report = (owner, error, revision) => {
			if (revision === undefined) report(owner, error);
			else report(owner, error, revision);
		};
	}

	getSnapshot = (): readonly Registration[] => this.entries;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** Register a new owner; replacement requires an explicitly prepared revision. */
	register(owner: string, extension: experimental_DesktopExtension): experimental_Disposable {
		if (this.owners.has(owner)) throw new Error(`Extension owner already registered: ${owner}`);
		return this.prepare(owner, extension).commit();
	}

	/** Validate a candidate without disturbing the live set; commit is a single publication. */
	prepare(
		owner: string,
		extension: experimental_DesktopExtension,
		revision?: string,
	): experimental_Disposable & { commit(): experimental_Disposable } {
		// Declaration-policy boundary: identities and supported versions cannot be expressed by these string/number types.
		if (!/^[a-zA-Z0-9._-]+$/.test(owner)) throw new Error(`Invalid extension owner: ${owner}`);
		if (extension.apiVersion !== 1) throw new Error(`Unsupported desktop apiVersion: ${extension.apiVersion}`);
		if (this.preparing.has(owner)) throw new Error(`Extension owner is preparing: ${owner}`);
		const previous = this.owners.get(owner);
		this.preparing.add(owner);
		const lifetime = new AbortController();
		const staged: Registration[] = [];
		const signals = new Map<AbortSignal, AbortController>();
		const disposers: (() => void)[] = [];
		let phase: "preparing" | "prepared" | "published" | "closed" = "preparing";
		const dispose = () => {
			if (phase === "closed") return;
			const published = phase === "published";
			phase = "closed";
			// Abort listeners may re-enter command dispatch, so revoke the whole set before invoking them.
			if (published) this.publish(this.entries.filter((entry) => !staged.includes(entry)));
			lifetime.abort();
			for (const controller of signals.values()) controller.abort();
			signals.clear();
			if (this.owners.get(owner) === dispose) this.owners.delete(owner);
			for (const cleanup of disposers.reverse()) {
				try {
					cleanup();
				} catch (error) {
					this.report(owner, error, revision);
				}
			}
		};
		const add = (entry: Registration): experimental_Disposable => {
			if (phase !== "preparing") throw new Error("The registration set is closed.");
			staged.push(entry);
			let disposed = false;
			return {
				dispose: () => {
					if (disposed) return;
					disposed = true;
					const controller = signals.get(entry.signal);
					const at = staged.indexOf(entry);
					if (at >= 0) staged.splice(at, 1);
					if (phase === "published") this.publish(this.entries.filter((other) => other !== entry));
					controller?.abort();
					signals.delete(entry.signal);
				},
			};
		};
		const metadata = (id: string) => {
			if (phase !== "preparing") throw new Error("The registration set is closed.");
			const controller = new AbortController();
			signals.set(controller.signal, controller);
			return {
				id: `${owner}/${id}`,
				owner,
				revision,
				sequence: this.sequence++,
				signal: controller.signal,
				reportError: (error: unknown) => this.report(owner, error, revision),
			};
		};
		const app: experimental_DesktopApp = {
			experimental_signal: lifetime.signal,
			experimental_registerCommand: (contribution) =>
				add({ ...metadata(contribution.id), kind: "command", contribution }),
			experimental_registerSlot: (contribution) => add({ ...metadata(contribution.id), kind: "slot", contribution }),
			experimental_registerProvider: (contribution) =>
				add({ ...metadata(contribution.id), kind: "provider", contribution }),
			experimental_onDispose: (cleanup) => {
				if (phase !== "preparing") throw new Error("The registration set is closed.");
				disposers.push(cleanup);
			},
		};
		try {
			const result: unknown = extension.experimental_setup(app);
			// Declaration-policy boundary: a void callback can return a promise, including another realm's thenable.
			if (
				result !== null &&
				(typeof result === "object" || typeof result === "function") &&
				"then" in result &&
				typeof result.then === "function"
			) {
				// Observe rejected async work even though its registration set is rejected synchronously.
				void Promise.resolve(result).catch((error: unknown) => this.report(owner, error, revision));
				throw new Error("Desktop extension setup must be synchronous.");
			}
			const ids = new Set<string>();
			for (const entry of staged) {
				// Declaration-policy boundary: local ids cannot contain another owner's namespace; order must be sortable.
				if (!/^[a-zA-Z0-9._-]+$/.test(entry.contribution.id)) throw new Error(`Invalid local id: ${entry.id}`);
				if (!Number.isFinite(entry.contribution.order ?? 0)) throw new Error(`Invalid order: ${entry.id}`);
				if (ids.has(entry.id)) throw new Error(`Duplicate registration: ${entry.id}`);
				ids.add(entry.id);
			}
			phase = "prepared";
			return {
				dispose,
				commit: () => {
					if (phase !== "prepared") throw new Error("The registration set is closed.");
					if (this.owners.get(owner) !== previous) {
						dispose();
						throw new Error("A newer registration set replaced this candidate.");
					}
					phase = "published";
					this.owners.set(owner, dispose);
					this.publish([...this.entries.filter((entry) => entry.owner !== owner), ...staged]);
					previous?.();
					return { dispose };
				},
			};
		} catch (error) {
			dispose();
			throw error;
		} finally {
			this.preparing.delete(owner);
		}
	}

	commands(context: experimental_CommandContext): CommandRegistration[] {
		return this.entries.filter(
			(entry): entry is CommandRegistration => entry.kind === "command" && this.available(entry, context),
		);
	}

	commandLabel(entry: CommandRegistration, context: experimental_CommandContext): string | undefined {
		try {
			return entry.contribution.label(context);
		} catch (error) {
			this.report(entry.owner, error);
			return undefined;
		}
	}

	runCommand(entry: CommandRegistration, context: experimental_CommandContext): void {
		if (!this.entries.includes(entry) || !this.available(entry, context)) return;
		try {
			const result = entry.contribution.experimental_run(context, entry.signal);
			if (result)
				void result.catch((error: unknown) => {
					if (!entry.signal.aborted) this.report(entry.owner, error, entry.revision);
				});
		} catch (error) {
			if (!entry.signal.aborted) this.report(entry.owner, error, entry.revision);
		}
	}

	slots(surface: experimental_Surface, context: experimental_CommandContext): SurfaceRegistration[] {
		return this.entries.filter(
			(entry): entry is SurfaceRegistration =>
				entry.kind === "slot" && entry.contribution.surface === surface && this.available(entry, context),
		);
	}

	/** Explicit choice only; absence or unavailability never rewrites the caller's preference. */
	resolveProvider(
		surface: experimental_Surface,
		builtin: string,
		preferred: string | undefined,
		context: experimental_CommandContext,
	): SurfaceRegistration | undefined {
		const providers = this.entries.filter(
			(entry): entry is SurfaceRegistration =>
				entry.kind === "provider" && entry.contribution.surface === surface && this.available(entry, context),
		);
		return providers.find((entry) => entry.id === preferred) ?? providers.find((entry) => entry.id === builtin);
	}

	private available(entry: Registration, context: experimental_CommandContext): boolean {
		try {
			return entry.contribution.experimental_available?.(context) ?? true;
		} catch (error) {
			this.report(entry.owner, error);
			return false;
		}
	}

	private publish(entries: readonly Registration[]): void {
		if (entries.length === this.entries.length && entries.every((entry, index) => entry === this.entries[index]))
			return;
		this.entries = [...entries].sort(
			(a, b) =>
				(a.contribution.order ?? 0) - (b.contribution.order ?? 0) ||
				(a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0) ||
				a.sequence - b.sequence,
		);
		for (const listener of this.listeners) listener();
	}
}
