/** Schema-checked frontend RPC and subscriptions bound to one immutable activation identity. */
import {
	DesktopCallResult,
	type DesktopActivationBinding,
	type DesktopBackendContracts,
} from "@knightcode/app-server-protocol";
import type { experimental_BackendClient, experimental_BackendResult } from "@knightcodeai/cli/desktop";
import type { experimental_BackendDataSelector } from "@knightcodeai/cli/desktop-backend";
import { Type, type Static, type TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { client } from "../client.ts";

const envelope = Compile(DesktopCallResult);
const settings = { id: "@settings/read", params: Type.Unknown(), result: Type.Record(Type.String(), Type.Unknown()) };
const setSetting = { ...settings, id: "@settings/write" };

export class FrontendBackend implements experimental_BackendClient {
	private readonly binding: DesktopActivationBinding;
	private readonly contracts: DesktopBackendContracts;
	private readonly signal: AbortSignal;
	private readonly admitted: () => boolean;

	constructor(
		binding: DesktopActivationBinding,
		contracts: DesktopBackendContracts,
		signal: AbortSignal,
		admitted: () => boolean,
	) {
		this.binding = binding;
		this.contracts = contracts;
		this.signal = signal;
		this.admitted = admitted;
	}

	async experimental_call<P extends TSchema, R extends TSchema>(
		method: { id: string; params: P; result: R },
		args: Static<P>,
		signal?: AbortSignal,
	): Promise<experimental_BackendResult<Static<R>>> {
		if (!this.admitted() || this.signal.aborted) return { status: "disconnected" };
		if (signal?.aborted) return { status: "cancelled" };
		const declaration = Object.hasOwn(this.contracts.methods, method.id)
			? this.contracts.methods[method.id]
			: undefined;
		if (!declaration) return { status: "error", message: `Unknown backend method: ${method.id}` };
		if (!Compile(method.params).Check(args) || !Compile(declaration.params).Check(args))
			return { status: "error", message: `Invalid backend parameters: ${method.id}` };
		const lifetime = signal ? AbortSignal.any([this.signal, signal]) : this.signal;
		const call = crypto.randomUUID();
		const disconnected = (): experimental_BackendResult<Static<R>> => ({
			status: declaration.kind === "write" ? "outcome-unknown" : signal?.aborted ? "cancelled" : "disconnected",
		});
		let abort = () => {};
		const gone = new Promise<experimental_BackendResult<Static<R>>>((resolve) => {
			abort = () => {
				resolve(disconnected());
				void client.host("host/desktopExtension/cancel", { binding: this.binding, call }).catch(() => {});
			};
		});
		lifetime.addEventListener("abort", abort, { once: true });
		try {
			const result = await Promise.race([
				client.host("host/desktopExtension/call", { binding: this.binding, call, method: method.id, args }),
				gone,
			]);
			if (lifetime.aborted || this.signal.aborted) return disconnected();
			// The native response and executable author's generic result schema are separate trust boundaries.
			if (!envelope.Check(result)) return { status: "error", message: "Invalid backend response envelope." };
			if (result.status !== "ok") return result;
			const check = Compile(method.result);
			if (!Compile(declaration.result).Check(result.value) || !check.Check(result.value))
				return { status: "error", message: `Invalid backend result: ${method.id}` };
			return { status: "ok", value: result.value };
		} catch {
			return disconnected();
		} finally {
			lifetime.removeEventListener("abort", abort);
		}
	}

	experimental_settings(context?: experimental_BackendDataSelector, signal?: AbortSignal) {
		return this.experimental_call(settings, { context: context ?? { scope: "app" } }, signal);
	}

	experimental_setSetting(
		id: string,
		value: unknown,
		context?: experimental_BackendDataSelector,
		signal?: AbortSignal,
	) {
		return this.experimental_call(setSetting, { id, value, context: context ?? { scope: "app" } }, signal);
	}

	experimental_subscribe<S extends TSchema>(
		event: { id: string; schema: S },
		listener: (value: Static<S>) => void,
		signal?: AbortSignal,
	) {
		if (!this.admitted() || this.signal.aborted || signal?.aborted || !Object.hasOwn(this.contracts.events, event.id))
			return { dispose() {} };
		const id = crypto.randomUUID();
		const lifetime = signal ? AbortSignal.any([this.signal, signal]) : this.signal;
		const check = Compile(event.schema);
		const declared = Compile(this.contracts.events[event.id]!);
		let disposed = false;
		const off = client.onHostEvent((packet) => {
			if (disposed || !this.admitted() || packet.event !== "desktopExtension/event") return;
			const value = packet.payload;
			if (value.id !== id || value.event !== event.id || !sameBinding(this.binding, value.binding)) return;
			if (declared.Check(value.value) && check.Check(value.value)) listener(value.value);
		});
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			off();
			lifetime.removeEventListener("abort", dispose);
			void client.host("host/desktopExtension/unsubscribe", { binding: this.binding, id }).catch(() => {});
		};
		lifetime.addEventListener("abort", dispose, { once: true });
		void client
			.host("host/desktopExtension/subscribe", { binding: this.binding, id, event: event.id })
			.then((result) => {
				if (result.status !== "subscribed") dispose();
			})
			.catch(dispose);
		return { dispose };
	}
}

function sameBinding(a: DesktopActivationBinding, b: DesktopActivationBinding): boolean {
	return (
		a.owner === b.owner &&
		a.revision === b.revision &&
		a.epoch === b.epoch &&
		a.window === b.window &&
		a.mount === b.mount
	);
}
