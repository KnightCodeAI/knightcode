/** Bounded presentation-only startup hints; cached data never grants artifact or execution authority. */
import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";

const Cache = Type.Object(
	{
		version: Type.Literal(1),
		providers: Type.Record(Type.String({ maxLength: 64 }), Type.String({ maxLength: 256 })),
		hidden: Type.Array(
			Type.Object(
				{
					owner: Type.String({ maxLength: 256 }),
					revision: Type.String({ maxLength: 256 }),
					target: Type.Union([Type.Literal("home"), Type.Literal("profile")]),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 256 },
		),
	},
	{ additionalProperties: false },
);
const check = Compile(Cache);
type Hidden = Static<typeof Cache>["hidden"];
const KEY = "knightcode.desktop.layout.v1";

export class StartupLayout {
	private snapshot: { grace: boolean; providers: Record<string, string>; hidden: Hidden };
	private storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
	private listeners = new Set<() => void>();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined, safeMode: boolean) {
		this.storage = storage;
		this.snapshot = { grace: !safeMode, providers: {}, hidden: [] };
		if (safeMode) return;
		try {
			const raw = storage?.getItem(KEY);
			if (raw) {
				// Storage is untrusted presentation data, including data written by older releases.
				const value: unknown = raw.length <= 131072 ? JSON.parse(raw) : null;
				if (check.Check(value)) this.snapshot = { grace: true, providers: value.providers, hidden: value.hidden };
				else storage?.removeItem(KEY);
			}
		} catch {
			/* Storage may be unavailable; built-ins must still paint. */
		}
		this.timer = setTimeout(() => {
			this.snapshot = { ...this.snapshot, grace: false };
			this.emit();
		}, 300);
	}

	getSnapshot = () => this.snapshot;

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** Persist only successful declarative presentation and explicit provider choices. */
	update(providers: Record<string, string>, hidden: Hidden): void {
		if (JSON.stringify([providers, hidden]) === JSON.stringify([this.snapshot.providers, this.snapshot.hidden])) return;
		this.snapshot = { ...this.snapshot, providers, hidden };
		try {
			this.storage?.setItem(KEY, JSON.stringify({ version: 1, providers, hidden }));
		} catch {
			/* Hints are optional. */
		}
		this.emit();
	}

	/** Authoritative native inventory invalidates stale cached visibility, never a saved preference. */
	reconcile(
		providers: Record<string, string>,
		inventory: readonly { owner: string; revision?: string; enabled: boolean; approved: boolean }[],
	): void {
		this.update(
			providers,
			this.snapshot.hidden.filter((hidden) =>
				inventory.some(
					(entry) =>
						entry.owner === hidden.owner && entry.revision === hidden.revision && entry.enabled && entry.approved,
				),
			),
		);
	}

	/** A failed activation cannot keep hiding native fallback navigation. */
	invalidateOwner(owner: string): void {
		this.update(
			this.snapshot.providers,
			this.snapshot.hidden.filter((entry) => entry.owner !== owner),
		);
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.listeners.clear();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
