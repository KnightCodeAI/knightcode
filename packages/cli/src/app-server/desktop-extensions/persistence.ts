/** Schema-checked owner data, separate from transcripts and never migrated during preparation. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Compile } from "typebox/compile";

const Stored = Type.Object(
	{
		settings: Type.Record(Type.String(), Type.Unknown()),
		storage: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false },
);
type Stored = Static<typeof Stored>;
type Kind = "settings" | "storage";
const checkStored = Compile(Stored);

export class DesktopBackendPersistence {
	private readonly directory: string;
	private readonly owner: string;
	private readonly records = new Map<string, Stored>();
	private readonly validations: ((record: Stored) => void)[] = [];

	constructor(directory: string, owner: string) {
		this.directory = directory;
		this.owner = owner;
		this.reload();
	}

	/** Reread all scopes after old writes drain; no stale preparation snapshot is published. */
	reload(): void {
		this.records.clear();
		this.read("app");
		const scopes = join(this.directory, this.owner);
		if (existsSync(scopes))
			for (const name of readdirSync(scopes)) {
				if (/^(project|thread)-[a-f0-9]{64}\.json$/.test(name)) this.read(name.slice(0, -5));
			}
		for (const record of this.records.values()) for (const validate of this.validations) validate(record);
	}

	/** Validate every saved scope, even if this activation has not requested that context yet. */
	declare(kind: Kind, id: string, schema: TSchema): void {
		const check = Compile(schema);
		const validate = (record: Stored) => {
			if (Object.hasOwn(record[kind], id) && !check.Check(record[kind][id]))
				throw new Error(`Invalid persisted ${kind}: ${id}`);
		};
		for (const record of this.records.values()) validate(record);
		this.validations.push(validate);
	}

	get(kind: Kind, id: string, keys: readonly string[], fallback: unknown): unknown {
		for (const key of keys) {
			const record = this.records.get(key);
			if (record && Object.hasOwn(record[kind], id)) return record[kind][id];
		}
		return fallback;
	}

	/** Persist only the exact scope; settings inheritance never copies values into child scopes. */
	set(kind: Kind, id: string, key: string, value: unknown): void {
		const previous = this.records.get(key) ?? { settings: {}, storage: {} };
		const record = { ...previous, [kind]: { ...previous[kind] } };
		// Declaration ids are dictionary keys, not prototype setters.
		Object.defineProperty(record[kind], id, { value, writable: true, enumerable: true, configurable: true });
		// Persisted-value boundary: a previous getter may have returned a mutable object.
		for (const validate of this.validations) validate(record);
		const target = this.path(key);
		mkdirSync(dirname(target), { recursive: true });
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
			renameSync(temporary, target);
			this.records.set(key, record);
		} finally {
			rmSync(temporary, { force: true });
		}
	}

	private read(key: string): void {
		const target = this.path(key);
		if (!existsSync(target)) return;
		const record: unknown = JSON.parse(readFileSync(target, "utf8"));
		if (!checkStored.Check(record)) throw new Error("Invalid persisted desktop extension data.");
		this.records.set(key, record);
	}

	private path(key: string): string {
		return key === "app" ? join(this.directory, `${this.owner}.json`) : join(this.directory, this.owner, `${key}.json`);
	}
}
