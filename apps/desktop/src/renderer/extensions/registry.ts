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
	sequence: number;
	signal: AbortSignal;
} & (
	| { kind: "command"; contribution: experimental_Command }
	| { kind: "slot" | "provider"; contribution: experimental_SurfaceContribution }
);

export type CommandRegistration = Extract<Registration, { kind: "command" }>;
export type SurfaceRegistration = Extract<Registration, { kind: "slot" | "provider" }>;

export class ExtensionRegistry {
	private entries: readonly Registration[] = [];
	private owners = new Set<string>();
	private listeners = new Set<() => void>();
	private sequence = 0;
	private report: (owner: string, error: unknown) => void;

	constructor(report: (owner: string, error: unknown) => void = (owner, error) => console.error(owner, error)) {
		this.report = report;
	}

	getSnapshot = (): readonly Registration[] => this.entries;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** Prepare synchronously; publish the entire set only after setup and validation succeed. */
	register(owner: string, extension: experimental_DesktopExtension): experimental_Disposable {
		// Declaration-policy boundary: identities and supported versions cannot be expressed by these string/number types.
		if (!/^[a-zA-Z0-9._-]+$/.test(owner)) throw new Error(`Invalid extension owner: ${owner}`);
		if (extension.apiVersion !== 1) throw new Error(`Unsupported desktop apiVersion: ${extension.apiVersion}`);
		if (this.owners.has(owner)) throw new Error(`Extension owner already registered: ${owner}`);
		this.owners.add(owner);
		const lifetime = new AbortController();
		const staged: Registration[] = [];
		const signals = new Map<AbortSignal, AbortController>();
		const disposers: (() => void)[] = [];
		let phase: "preparing" | "published" | "closed" = "preparing";
		const dispose = () => {
			if (phase === "closed") return;
			const published = phase === "published";
			phase = "closed";
			lifetime.abort();
			for (const controller of signals.values()) controller.abort();
			signals.clear();
			this.owners.delete(owner);
			if (published) this.publish(this.entries.filter((entry) => entry.owner !== owner));
			for (const cleanup of disposers.reverse()) {
				try {
					cleanup();
				} catch (error) {
					this.report(owner, error);
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
					signals.get(entry.signal)?.abort();
					signals.delete(entry.signal);
					const at = staged.indexOf(entry);
					if (at >= 0) staged.splice(at, 1);
					if (phase === "published") this.publish(this.entries.filter((other) => other !== entry));
				},
			};
		};
		const metadata = (id: string) => {
			if (phase !== "preparing") throw new Error("The registration set is closed.");
			const controller = new AbortController();
			signals.set(controller.signal, controller);
			return { id: `${owner}/${id}`, owner, sequence: this.sequence++, signal: controller.signal };
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
			extension.experimental_setup(app);
			const ids = new Set<string>();
			for (const entry of staged) {
				// Declaration-policy boundary: local ids cannot contain another owner's namespace; order must be sortable.
				if (!/^[a-zA-Z0-9._-]+$/.test(entry.contribution.id)) throw new Error(`Invalid local id: ${entry.id}`);
				if (!Number.isFinite(entry.contribution.order ?? 0)) throw new Error(`Invalid order: ${entry.id}`);
				if (ids.has(entry.id)) throw new Error(`Duplicate registration: ${entry.id}`);
				ids.add(entry.id);
			}
			phase = "published";
			this.publish([...this.entries, ...staged]);
			return { dispose };
		} catch (error) {
			dispose();
			throw error;
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
			if (result) void result.catch((error: unknown) => this.report(entry.owner, error));
		} catch (error) {
			this.report(entry.owner, error);
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
		this.entries = [...entries].sort(
			(a, b) =>
				(a.contribution.order ?? 0) - (b.contribution.order ?? 0) ||
				(a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0) ||
				a.sequence - b.sequence,
		);
		for (const listener of this.listeners) listener();
	}
}
