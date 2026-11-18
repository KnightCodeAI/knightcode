/** Native port lifetimes authenticate extension traffic; transport loss never replays an ambiguous write. */
import { randomUUID } from "node:crypto";
import {
	DesktopExtensionEvent,
	DesktopExtensionPhase,
	type DesktopActivationBinding,
	DesktopCallResult as CallResultSchema,
	type Message,
} from "@knightcode/app-server-protocol";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import type { HostEvent } from "../shared/host-protocol.ts";
import type { ServerConnection } from "./server.ts";

type Binding = DesktopActivationBinding;
type Result = Static<typeof CallResultSchema>;
type Metadata = {
	binding: Binding;
	artifact: NonNullable<DesktopExtensionPhase["artifact"]>;
	contracts: NonNullable<DesktopExtensionPhase["contracts"]>;
};
type Frame = { binding: Binding; sequence: number; disconnect(): void };
type WindowHost = {
	lifetime: string;
	controller: AbortController;
	connected: boolean;
	post(event: HostEvent): void;
	ready: Map<string, Metadata>;
	candidates: Map<string, Metadata>;
	gated: Set<string>;
	calls: Map<string, Frame>;
};
const phaseCheck = Compile(DesktopExtensionPhase);
const eventCheck = Compile(DesktopExtensionEvent);
const resultCheck = Compile(CallResultSchema);

export class DesktopExtensionWindows {
	private readonly server: ServerConnection;
	private readonly windows = new Map<number, WindowHost>();
	constructor(server: ServerConnection) {
		this.server = server;
	}

	attach(windowId: number, post: (event: HostEvent) => void): void {
		this.detach(windowId);
		this.windows.set(windowId, this.host(post));
	}

	detach(windowId: number): void {
		const window = this.windows.get(windowId);
		if (!window) return;
		this.windows.delete(windowId);
		window.controller.abort();
		if (window.connected && this.server.state === "ready")
			void this.server
				.request("desktopExtension/window/disconnect", { windowId, lifetime: window.lifetime })
				.catch(() => {});
	}

	async connect(windowId: number): Promise<void> {
		const window = this.windows.get(windowId);
		if (!window || this.server.state !== "ready") throw new Error("Desktop server is disconnected.");
		// Closing an in-flight handshake must also revoke the peer already created by the server.
		window.connected = true;
		try {
			await this.server.request("desktopExtension/window/connect", { windowId, lifetime: window.lifetime });
		} catch (error) {
			window.connected = false;
			throw error;
		}
	}

	forward(windowId: number, method: string, params: object): Promise<unknown> {
		const window = this.windows.get(windowId);
		if (!window || this.server.state !== "ready") return Promise.reject(new Error("Desktop server is disconnected."));
		return this.server.request(method, { ...params, windowId, lifetime: window.lifetime });
	}

	async call(
		windowId: number,
		sequence: number,
		params: { binding: Binding; call: string; method: string; args: unknown },
	): Promise<Result> {
		const window = this.windows.get(windowId);
		const metadata = window?.ready.get(params.binding.owner);
		const key = `${params.binding.owner}/${params.call}`;
		if (
			!window?.connected ||
			this.server.state !== "ready" ||
			!metadata ||
			!sameBinding(metadata.binding, params.binding) ||
			window.gated.has(params.binding.owner) ||
			window.calls.has(key)
		)
			return { status: "disconnected" };
		const method = Object.hasOwn(metadata.contracts.methods, params.method)
			? metadata.contracts.methods[params.method]
			: undefined;
		if (!method) return { status: "error", message: `Unknown backend method: ${params.method}` };
		const disconnected: Result = { status: method.kind === "write" ? "outcome-unknown" : "disconnected" };
		let revoke!: () => void;
		const gone = new Promise<Result>((resolve) => {
			revoke = () => resolve(disconnected);
		});
		const frame: Frame = { binding: params.binding, sequence, disconnect: revoke };
		window.calls.set(key, frame);
		window.controller.signal.addEventListener("abort", revoke, { once: true });
		try {
			const result = await Promise.race([
				this.server
					.request("desktopExtension/call", {
						windowId,
						lifetime: window.lifetime,
						binding: params.binding,
						requestId: sequence,
						method: params.method,
						args: params.args,
					})
					.then((value) => (resultCheck.Check(value) ? value : disconnected))
					.catch(() => disconnected),
				gone,
			]);
			return this.windows.get(windowId) === window &&
				sameBinding(window.ready.get(params.binding.owner)?.binding, params.binding)
				? result
				: disconnected;
		} finally {
			window.controller.signal.removeEventListener("abort", revoke);
			if (window.calls.get(key) === frame) window.calls.delete(key);
		}
	}

	async cancel(windowId: number, params: { binding: Binding; call: string }): Promise<void> {
		const window = this.windows.get(windowId);
		const frame = window?.calls.get(`${params.binding.owner}/${params.call}`);
		if (!frame || !sameBinding(frame.binding, params.binding)) return;
		await this.forward(windowId, "desktopExtension/cancel", { binding: params.binding, requestId: frame.sequence });
	}

	/** Only phase/event wire schemas from this exact native lifetime may target its renderer. */
	receive(message: Message): boolean {
		if (!("method" in message) || "id" in message) return false;
		if (message.method === "desktopExtension/phase") {
			const phase = message.params;
			if (!phaseCheck.Check(phase)) return true;
			const window = this.windows.get(phase.windowId);
			if (!window || window.lifetime !== phase.lifetime) return true;
			const owner = phase.binding.owner;
			if (phase.artifact && (phase.artifact.owner !== owner || phase.artifact.revision !== phase.binding.revision))
				return true;
			const metadata =
				phase.artifact && phase.contracts
					? { binding: phase.binding, artifact: phase.artifact, contracts: phase.contracts }
					: undefined;
			if (phase.phase === "prepare" && metadata) window.candidates.set(owner, metadata);
			if (phase.phase === "quiesce" || phase.phase === "publish") window.gated.add(owner);
			if (phase.phase === "publish") window.ready.delete(owner);
			if (phase.phase === "discard" && sameBinding(window.candidates.get(owner)?.binding, phase.binding))
				window.candidates.delete(owner);
			if (phase.phase === "revoke") {
				window.ready.delete(owner);
				window.candidates.delete(owner);
				window.gated.add(owner);
				for (const frame of window.calls.values()) if (frame.binding.owner === owner) frame.disconnect();
			}
			if (phase.phase === "ready" && metadata) {
				window.ready.set(owner, metadata);
				const candidate = window.candidates.get(owner);
				if (!candidate || sameBinding(candidate.binding, phase.binding)) {
					window.candidates.delete(owner);
					window.gated.delete(owner);
				}
			}
			window.post({ event: "desktopExtension/phase", phase });
			return true;
		}
		if (message.method === "desktopExtension/event") {
			const event = message.params;
			if (!eventCheck.Check(event)) return true;
			const window = this.windows.get(event.windowId);
			if (
				window?.lifetime === event.lifetime &&
				!window.gated.has(event.binding.owner) &&
				sameBinding(window.ready.get(event.binding.owner)?.binding, event.binding)
			)
				window.post({ event: "desktopExtension/event", payload: event });
			return true;
		}
		return false;
	}

	/** A restarted server has no authority from the old handshake, even when native windows survive. */
	serverRestarted(): void {
		for (const [id, window] of this.windows) {
			window.controller.abort();
			this.windows.set(id, this.host(window.post));
		}
	}

	artifact(windowId: number, owner: string, revision: string): Metadata["artifact"] | undefined {
		const window = this.windows.get(windowId);
		const candidate = window?.candidates.get(owner);
		const active = window?.ready.get(owner);
		return candidate?.artifact.revision === revision
			? candidate.artifact
			: active?.artifact.revision === revision
				? active.artifact
				: undefined;
	}

	private host(post: (event: HostEvent) => void): WindowHost {
		return {
			lifetime: randomUUID(),
			controller: new AbortController(),
			connected: false,
			post,
			ready: new Map(),
			candidates: new Map(),
			gated: new Set(),
			calls: new Map(),
		};
	}
}

function sameBinding(a: Binding | undefined, b: Binding): boolean {
	return (
		!!a &&
		a.owner === b.owner &&
		a.revision === b.revision &&
		a.epoch === b.epoch &&
		a.window === b.window &&
		a.mount === b.mount
	);
}
