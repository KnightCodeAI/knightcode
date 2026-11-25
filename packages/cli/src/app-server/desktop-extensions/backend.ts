/** Prepare schema-checked backend declarations; persisted values and active services never run during setup. */
import { Type, type TSchema } from "typebox";
import type { DesktopBackendContracts } from "@knightcode/app-server-protocol";
import { Compile } from "typebox/compile";
import { importExtensionDefault } from "../../core/extensions/loader.ts";
import type {
	experimental_BackendContext,
	experimental_BackendDataContext,
	experimental_DesktopBackend,
	experimental_DesktopBackendApp,
} from "../../desktop-backend.ts";
import type { AppServerContext } from "../context.ts";
import type { DesktopBackendActivation } from "./coordinator.ts";
import { DesktopDataSelector, resolveDesktopDataContext, type DesktopDataContext } from "./data-context.ts";
import { DesktopBackendPersistence } from "./persistence.ts";

type Method = {
	kind: "read" | "write";
	params: TSchema;
	result: TSchema;
	invoke(params: unknown, signal: AbortSignal): Promise<unknown>;
};
type Setting = {
	secret: boolean;
	get(context?: experimental_BackendDataContext): unknown;
	set(value: unknown, context?: experimental_BackendDataContext): void;
};
type Activate = Parameters<experimental_DesktopBackendApp["experimental_onActivate"]>[0];
type Cleanup = () => void | Promise<void>;

/** Import through the existing session resolver, then validate the complete inert backend declaration. */
export async function prepareDesktopBackend(
	entry: string,
	owner: string,
	directory: string,
	emit: (id: string, value: unknown) => void,
	context?: AppServerContext,
): Promise<DesktopBackend> {
	const module = await importExtensionDefault(entry);
	// Executable default export is a trust boundary, not a same-host typed declaration.
	if (
		!module ||
		typeof module !== "object" ||
		!("apiVersion" in module) ||
		module.apiVersion !== 1 ||
		!("experimental_setup" in module) ||
		typeof module.experimental_setup !== "function"
	)
		throw new Error("Default backend export must be experimental_defineDesktopBackend(...) with apiVersion 1.");
	return new DesktopBackend(owner, directory, module as experimental_DesktopBackend, emit, context);
}

export class DesktopBackend implements DesktopBackendActivation {
	private readonly methods = new Map<string, Method>();
	private readonly events = new Map<string, TSchema>();
	private readonly settings = new Map<string, Setting>();
	private readonly activators: Activate[] = [];
	private readonly cleanups: Cleanup[] = [];
	private readonly pauses: Cleanup[] = [];
	private readonly resumes: Cleanup[] = [];
	private readonly lifetime = new AbortController();
	private state: "prepared" | "active" | "closed" = "prepared";
	private paused = false;
	private disposal?: Promise<void>;
	private readonly persistence: DesktopBackendPersistence;
	private readonly contexts = new WeakMap<experimental_BackendDataContext, DesktopDataContext>();

	constructor(
		owner: string,
		directory: string,
		definition: experimental_DesktopBackend,
		emit: (id: string, value: unknown) => void,
		context?: AppServerContext,
	) {
		// Host identity is a declaration-policy boundary: it becomes one local filename.
		if (!/^[a-zA-Z0-9._-]+$/.test(owner) || owner === "." || owner === "..") throw new Error("Invalid backend owner.");
		this.persistence = new DesktopBackendPersistence(directory, owner);
		const ids = new Set<string>();
		let preparing = true;
		const declare = (id: string) => {
			if (!preparing) throw new Error("Backend declaration set is closed.");
			if (!/^[a-zA-Z0-9._-]+$/.test(id) || ids.has(id))
				throw new Error(`Invalid or duplicate backend declaration: ${id}`);
			ids.add(id);
		};
		const value = <S extends TSchema>(kind: "settings" | "storage", id: string, schema: S, fallback: unknown) => {
			declare(id);
			const check = Compile(schema);
			this.persistence.declare(kind, id, schema);
			return {
				get: (dataContext?: experimental_BackendDataContext) => {
					this.assertActive();
					const keys = this.dataKeys(dataContext);
					const current = this.persistence.get(kind, id, kind === "settings" ? keys : [keys[0]!], fallback);
					// Read-boundary check also prevents a mutable backend value from bypassing the persisted schema.
					if (current !== undefined && !check.Check(current)) throw new Error(`Invalid ${kind}: ${id}`);
					return current;
				},
				set: (next: unknown, dataContext?: experimental_BackendDataContext) => {
					this.assertActive();
					const keys = this.dataKeys(dataContext);
					if (!check.Check(next)) throw new Error(`Invalid ${kind}: ${id}`);
					this.persistence.set(kind, id, keys[0]!, next);
				},
			};
		};
		const app: experimental_DesktopBackendApp = {
			experimental_context: async (selector, signal) => {
				this.assertActive();
				const resolved = await resolveDesktopDataContext(
					context,
					selector,
					AbortSignal.any([signal, this.lifetime.signal]),
				);
				this.assertActive();
				// The private TypeScript brand is backed by this activation's WeakMap, not a forgeable wire field.
				const token = { scope: selector.scope } as experimental_BackendDataContext;
				this.contexts.set(token, resolved);
				return token;
			},
			experimental_registerRpc: (method) => {
				declare(method.id);
				const params = Compile(method.params);
				const result = Compile(method.result);
				this.methods.set(method.id, {
					kind: method.kind,
					params: method.params,
					result: method.result,
					invoke: async (input, signal) => {
						if (!params.Check(input)) throw new Error(`Invalid RPC parameters: ${method.id}`);
						const output = await method.experimental_handle(input, signal);
						if (!result.Check(output)) throw new Error(`Invalid RPC result: ${method.id}`);
						return output;
					},
				});
			},
			experimental_setting: (setting) => {
				if (!Compile(setting.schema).Check(setting.default)) throw new Error(`Invalid setting default: ${setting.id}`);
				const handle = value("settings", setting.id, setting.schema, setting.default);
				this.settings.set(setting.id, { secret: setting.secret ?? false, ...handle });
				// The schema check above and on each read decides this heterogeneous declaration's type.
				return { experimental_get: handle.get, experimental_set: handle.set } as ReturnType<
					typeof app.experimental_setting<typeof setting.schema>
				>;
			},
			experimental_storage: (storage) => {
				const handle = value("storage", storage.id, storage.schema, undefined);
				// The declaration schema is retained by this handle and checked at its persistence boundary.
				return { experimental_get: handle.get, experimental_set: handle.set } as ReturnType<
					typeof app.experimental_storage<typeof storage.schema>
				>;
			},
			experimental_event: (event) => {
				declare(event.id);
				const check = Compile(event.schema);
				this.events.set(event.id, event.schema);
				return {
					experimental_emit: (data) => {
						if (this.state !== "active" || this.paused) return false;
						if (!check.Check(data)) throw new Error(`Invalid backend event: ${event.id}`);
						emit(event.id, data);
						return true;
					},
				};
			},
			experimental_onActivate: (activate) => {
				if (!preparing) throw new Error("Backend declaration set is closed.");
				this.activators.push(activate);
			},
		};
		const readSettings = Type.Object({ context: Type.Optional(DesktopDataSelector) }, { additionalProperties: false });
		const writeSettings = Type.Object(
			{ id: Type.String(), value: Type.Unknown(), context: Type.Optional(DesktopDataSelector) },
			{ additionalProperties: false },
		);
		const readCheck = Compile(readSettings);
		const writeCheck = Compile(writeSettings);
		const settingsResult = Type.Record(Type.String(), Type.Unknown());
		// Reserved names cannot be declared by authors; native transport still classifies these methods server-side.
		this.methods.set("@settings/read", {
			kind: "read",
			params: readSettings,
			result: settingsResult,
			invoke: async (input, signal) => {
				if (!readCheck.Check(input)) throw new Error("Invalid settings read parameters.");
				return this.publicSettings(await app.experimental_context(input.context ?? { scope: "app" }, signal));
			},
		});
		this.methods.set("@settings/write", {
			kind: "write",
			params: writeSettings,
			result: settingsResult,
			invoke: async (input, signal) => {
				if (!writeCheck.Check(input)) throw new Error("Invalid settings write parameters.");
				const dataContext = await app.experimental_context(input.context ?? { scope: "app" }, signal);
				this.setPublicSetting(input.id, input.value, dataContext);
				return this.publicSettings(dataContext);
			},
		});
		try {
			const result: unknown = definition.experimental_setup(app);
			// Declaration-policy boundary: a void callback may still return an async result.
			if (
				result !== null &&
				(typeof result === "object" || typeof result === "function") &&
				"then" in result &&
				typeof result.then === "function"
			) {
				void Promise.resolve(result).catch(() => {});
				throw new Error("Backend setup must return synchronous declarations only.");
			}
		} finally {
			preparing = false;
		}
	}

	/** Publish only declared wire schemas; secret setting values never enter this contract. */
	contracts(): DesktopBackendContracts {
		return {
			methods: Object.fromEntries(
				[...this.methods].map(([id, method]) => [
					id,
					{ kind: method.kind, params: method.params, result: method.result },
				]),
			),
			events: Object.fromEntries(this.events),
		};
	}

	/** The server, never frontend wire input, classifies ambiguous read/write outcomes. */
	kind(method: string): "read" | "write" {
		const declaration = this.methods.get(method);
		if (!declaration) throw new Error(`Unknown backend RPC method: ${method}`);
		return declaration.kind;
	}

	async call(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
		this.assertActive();
		const declaration = this.methods.get(method);
		if (!declaration) throw new Error(`Unknown backend RPC method: ${method}`);
		return declaration.invoke(params, signal);
	}

	/** Frontends receive an explicit non-secret projection, never the persisted settings document. */
	publicSettings(context?: experimental_BackendDataContext): Record<string, unknown> {
		this.assertActive();
		return Object.fromEntries(
			[...this.settings].filter(([, setting]) => !setting.secret).map(([id, setting]) => [id, setting.get(context)]),
		);
	}

	setPublicSetting(id: string, next: unknown, context?: experimental_BackendDataContext): void {
		this.assertActive();
		const setting = this.settings.get(id);
		if (!setting || setting.secret) throw new Error("Unknown or secret setting is not available to the frontend.");
		setting.set(next, context);
	}

	async activate(): Promise<void> {
		if (this.state !== "prepared") throw new Error("Backend activation is not prepared.");
		// Admitted old writes may have completed after preparation; never activate their stale storage snapshot.
		this.persistence.reload();
		this.state = "active";
		const context: experimental_BackendContext = {
			experimental_signal: this.lifetime.signal,
			experimental_onDispose: (cleanup) => {
				this.assertActive();
				this.cleanups.push(cleanup);
			},
			experimental_onPause: (pause) => {
				this.assertActive();
				this.pauses.push(pause);
			},
			experimental_onResume: (resume) => {
				this.assertActive();
				this.resumes.push(resume);
			},
		};
		for (const activate of this.activators) {
			const cleanup = await activate(context);
			if (this.lifetime.signal.aborted) {
				if (cleanup) await cleanup();
				throw new Error("Desktop backend is inactive.");
			}
			if (cleanup) this.cleanups.push(cleanup);
		}
	}

	async pause(): Promise<void> {
		this.assertActive();
		this.paused = true;
		for (const pause of this.pauses) await pause();
	}

	async resume(): Promise<void> {
		this.assertActive();
		for (const resume of this.resumes) await resume();
		this.paused = false;
	}

	/** Revoke first, then continue all cleanup even when one service fails; repeated disposal shares its result. */
	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.state = "closed";
		this.lifetime.abort();
		this.disposal = (async () => {
			const errors: unknown[] = [];
			for (const cleanup of this.cleanups.reverse()) {
				try {
					await cleanup();
				} catch (error) {
					errors.push(error);
				}
			}
			if (errors.length) throw new AggregateError(errors, "Backend service shutdown failed.");
		})();
		return this.disposal;
	}

	private dataKeys(context: experimental_BackendDataContext | undefined): string[] {
		if (!context) return ["app"];
		const resolved = this.contexts.get(context);
		if (!resolved) throw new Error("Data context belongs to another backend activation.");
		resolved.validate();
		return resolved.keys;
	}

	private assertActive(): void {
		if (this.state !== "active") throw new Error("Desktop backend is inactive.");
	}
}
