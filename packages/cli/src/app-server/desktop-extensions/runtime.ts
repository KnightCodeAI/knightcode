/** One process-wide owner coordinator, with authenticated window lifetimes and epoch-scoped wire callbacks. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
	DesktopActivationBinding,
	DesktopBackendContracts,
	DesktopExtensionPhase,
	ParamsOf,
	ResultOf,
} from "@knightcode/app-server-protocol";
import type { AppServer } from "../server.ts";
import type { AppServerContext } from "../context.ts";
import type { DesktopArtifact } from "./artifacts.ts";
import { DesktopBackend, prepareDesktopBackend } from "./backend.ts";
import { DesktopRevisionCoordinator, type DesktopCallResult, type DesktopWindowParticipant } from "./coordinator.ts";
import type { DesktopExtensionManager } from "./manager.ts";

type Identity = { windowId: number; lifetime: string };
type Metadata = {
	artifact: DesktopArtifact;
	backend: DesktopBackend;
	contracts: DesktopBackendContracts;
	epoch?: string;
};
type Owner = {
	coordinator: DesktopRevisionCoordinator;
	initialized: Promise<void>;
	attempted?: string;
	reload?: number;
	live?: Metadata;
	candidate?: Metadata;
	pending?: Promise<void>;
	retiring?: Promise<void>;
};
type Subscription = { binding: DesktopActivationBinding; event: string; id: string };
type Peer = Identity & {
	key: string;
	connection: AppServer;
	controller: AbortController;
	signal: AbortSignal;
	subscriptions: Map<string, Subscription>;
};
type Acknowledgement = { peer: Peer; binding: DesktopActivationBinding; settle(error?: string): void };

export class DesktopBackendRuntime {
	private readonly manager: DesktopExtensionManager;
	private readonly data: string;
	private readonly context: AppServerContext;
	private readonly peers = new Map<string, Peer>();
	private readonly owners = new Map<string, Owner>();
	private readonly acknowledgements = new Map<string, Acknowledgement>();
	private disposed = false;
	private reconciliation = 0;
	private explicitReload = 0;

	constructor(manager: DesktopExtensionManager, context: AppServerContext) {
		this.manager = manager;
		this.context = context;
		this.data = join(context.agentDir, "desktop-extension-data");
	}

	async connect(identity: Identity, connection: AppServer): Promise<void> {
		if (this.disposed || connection.signal.aborted) return;
		const key = `${connection.id}:${identity.windowId}`;
		const previous = this.peers.get(key);
		if (previous?.lifetime === identity.lifetime) return;
		previous?.controller.abort();
		const controller = new AbortController();
		const peer: Peer = {
			...identity,
			key,
			connection,
			controller,
			signal: AbortSignal.any([controller.signal, connection.signal]),
			subscriptions: new Map(),
		};
		this.peers.set(key, peer);
		peer.signal.addEventListener(
			"abort",
			() => {
				if (this.peers.get(key) !== peer) return;
				this.peers.delete(key);
				peer.subscriptions.clear();
				for (const owner of this.owners.values()) owner.coordinator.leave(key);
			},
			{ once: true },
		);
		for (const [id, owner] of this.owners) {
			await owner.coordinator.join(this.participant(id, owner, peer));
			this.ready(owner, peer);
		}
	}

	disconnect(identity: Identity, connection: AppServer): void {
		this.peer(identity, connection)?.controller.abort();
	}

	ack(params: ParamsOf<"desktopExtension/ack">, connection: AppServer): void {
		const peer = this.peer(params, connection);
		const pending = this.acknowledgements.get(params.id);
		if (peer && pending?.peer === peer && sameBinding(params.binding, pending.binding)) pending.settle(params.error);
	}

	async reconcileWindow(params: ParamsOf<"desktopExtension/reconcile">, connection: AppServer): Promise<void> {
		if (!this.peer(params, connection)) throw new Error("Desktop window handshake is no longer live.");
		await this.reconcile(params.cwd);
	}

	/** Inventory refreshes do not replay RPC; identical settled revisions remain active unless explicitly reloaded. */
	async reconcile(cwd?: string, force = false): Promise<void> {
		const generation = ++this.reconciliation;
		if (force) this.explicitReload++;
		const { artifacts: candidates, enabled: desired } = await this.manager.candidates(cwd);
		if (this.disposed || !this.peers.size || generation !== this.reconciliation) return;
		await Promise.all(
			[...this.owners]
				.filter(([id]) => !desired.has(id))
				.map(([id, owner]) => (owner.retiring ??= this.retire(id, owner))),
		);
		await Promise.all(
			candidates.map(async (artifact) => {
				let owner = this.owners.get(artifact.owner);
				if (owner?.retiring) {
					await owner.retiring;
					owner = this.owners.get(artifact.owner);
				}
				if (this.disposed || generation !== this.reconciliation || !this.manager.admits(artifact)) return;
				if (!owner) {
					owner = { coordinator: new DesktopRevisionCoordinator(artifact.owner), initialized: Promise.resolve() };
					this.owners.set(artifact.owner, owner);
					const state = owner;
					// Queue the complete participant snapshot before any overlapping reconciliation may update it.
					state.initialized = Promise.all(
						[...this.peers.values()].map((peer) =>
							state.coordinator.join(this.participant(artifact.owner, state, peer)),
						),
					).then(() => {});
				}
				await owner.initialized;
				while (owner.pending) await owner.pending;
				if (
					this.disposed ||
					generation !== this.reconciliation ||
					this.owners.get(artifact.owner) !== owner ||
					!this.manager.admits(artifact)
				)
					return;
				if (owner.reload === this.explicitReload && owner.attempted === artifact.revision) return;
				owner.attempted = artifact.revision;
				owner.reload = this.explicitReload;
				const state = owner;
				const pending = this.activate(state, artifact);
				state.pending = pending;
				try {
					await pending;
				} finally {
					if (state.pending === pending) state.pending = undefined;
				}
			}),
		);
	}

	async call(params: ParamsOf<"desktopExtension/call">, connection: AppServer): Promise<DesktopCallResult> {
		const peer = this.peer(params, connection);
		const owner = this.owners.get(params.binding.owner);
		if (!peer || params.binding.window !== peer.key || !owner?.live || !owner.coordinator.accepts(params.binding))
			return { status: "disconnected" };
		try {
			return await owner.coordinator.call(
				params.binding,
				params.requestId,
				owner.live.backend.kind(params.method),
				params.method,
				params.args,
			);
		} catch (error) {
			return { status: "error", message: error instanceof Error ? error.message : String(error) };
		}
	}

	fail(params: ParamsOf<"desktopExtension/fail">, connection: AppServer): void {
		const peer = this.peer(params, connection);
		if (peer?.key !== params.binding.window) return;
		if (this.owners.get(params.binding.owner)?.coordinator.revoke(params.binding))
			this.manager.report(params.binding.owner, {
				windowId: peer.windowId,
				revision: params.binding.revision,
				phase: "render",
				message: params.message,
			});
	}

	cancel(params: ParamsOf<"desktopExtension/cancel">, connection: AppServer): void {
		const peer = this.peer(params, connection);
		if (peer?.key === params.binding.window)
			this.owners.get(params.binding.owner)?.coordinator.cancel(params.binding, params.requestId);
	}

	subscribe(
		params: ParamsOf<"desktopExtension/subscribe">,
		connection: AppServer,
	): { status: "subscribed" | "disconnected" } {
		const peer = this.peer(params, connection);
		const owner = this.owners.get(params.binding.owner);
		const key = `${params.binding.owner}/${params.id}`;
		if (
			!peer ||
			peer.key !== params.binding.window ||
			!owner?.live ||
			!owner.coordinator.accepts(params.binding) ||
			!Object.hasOwn(owner.live.contracts.events, params.event) ||
			peer.subscriptions.has(key)
		)
			return { status: "disconnected" };
		peer.subscriptions.set(key, { binding: params.binding, event: params.event, id: params.id });
		return { status: "subscribed" };
	}

	unsubscribe(params: ParamsOf<"desktopExtension/unsubscribe">, connection: AppServer): void {
		const peer = this.peer(params, connection);
		const key = `${params.binding.owner}/${params.id}`;
		const previous = peer?.subscriptions.get(key);
		if (previous && sameBinding(previous.binding, params.binding)) peer!.subscriptions.delete(key);
	}

	/** Whether a live owner is missing from this inventory, as when its package folder was removed. */
	outlives(status: ResultOf<"desktopExtension/list">): boolean {
		const listed = new Set(status.extensions.map((entry) => entry.owner));
		return [...this.owners.keys()].some((owner) => !listed.has(owner));
	}

	/** Host/process teardown clears authority immediately; shutdown still accounts for admitted backend work. */
	dispose(): void {
		this.disposed = true;
		for (const peer of this.peers.values()) peer.controller.abort();
		for (const owner of this.owners.values()) void owner.coordinator.shutdown();
		this.owners.clear();
	}

	private peer(identity: Identity, connection: AppServer): Peer | undefined {
		const peer = this.peers.get(`${connection.id}:${identity.windowId}`);
		return peer && peer.connection === connection && peer.lifetime === identity.lifetime && !peer.signal.aborted
			? peer
			: undefined;
	}

	private async retire(id: string, owner: Owner): Promise<void> {
		try {
			const result = await owner.coordinator.shutdown();
			if (this.owners.get(id) !== owner) return;
			this.clearSubscriptions(id);
			owner.live = undefined;
			if (result.status === "retired") this.owners.delete(id);
		} finally {
			owner.retiring = undefined;
		}
	}

	private async activate(owner: Owner, artifact: DesktopArtifact): Promise<void> {
		let candidate: Metadata | undefined;
		const result = await owner.coordinator.update(artifact.revision, async (signal) => {
			if (!this.manager.admits(artifact))
				throw new Error("Desktop native consent or project trust changed before admission.");
			const emit = (event: string, value: unknown) => {
				if (!candidate || owner.live !== candidate) return;
				for (const peer of this.peers.values())
					for (const subscription of peer.subscriptions.values()) {
						if (
							subscription.binding.owner === artifact.owner &&
							subscription.event === event &&
							owner.coordinator.accepts(subscription.binding)
						)
							peer.connection.notify("desktopExtension/event", {
								windowId: peer.windowId,
								lifetime: peer.lifetime,
								binding: subscription.binding,
								id: subscription.id,
								event,
								value,
							});
					}
			};
			const backend = artifact.backend
				? await prepareDesktopBackend(
						join(artifact.root, artifact.backend),
						artifact.owner,
						this.data,
						emit,
						this.context,
					)
				: new DesktopBackend(artifact.owner, this.data, { apiVersion: 1, experimental_setup() {} }, emit, this.context);
			if (signal.aborted) {
				await backend.dispose();
				throw new Error("Activation revoked.");
			}
			candidate = { artifact, backend, contracts: backend.contracts() };
			owner.candidate = candidate;
			return backend;
		});
		if (this.owners.get(artifact.owner) !== owner) return;
		if (result.status === "committed" && candidate) {
			candidate.epoch = result.epoch;
			owner.live = candidate;
			this.clearSubscriptions(artifact.owner);
		} else if (result.status === "disabled") {
			owner.live = undefined;
			this.clearSubscriptions(artifact.owner);
		}
		if (owner.candidate === candidate) owner.candidate = undefined;
		if (result.status !== "committed")
			for (const peer of this.peers.values())
				this.manager.report(artifact.owner, {
					windowId: peer.windowId,
					revision: artifact.revision,
					phase: "load",
					message: result.reason.slice(0, 4096),
				});
		for (const peer of this.peers.values()) this.ready(owner, peer);
	}

	private participant(id: string, owner: Owner, peer: Peer): DesktopWindowParticipant {
		let last: DesktopActivationBinding | undefined;
		const phase = (name: DesktopExtensionPhase["phase"], binding: DesktopActivationBinding, signal: AbortSignal) => {
			last = binding;
			const metadata = owner.live?.epoch === binding.epoch ? owner.live : owner.candidate;
			return this.phase(peer, binding, name, signal, name === "prepare" ? metadata : undefined);
		};
		return {
			id: peer.key,
			signal: peer.signal,
			prepare: (binding, signal) => phase("prepare", binding, signal),
			quiesce: (binding, signal) => phase("quiesce", binding, signal),
			publish: (binding, signal) => phase("publish", binding, signal),
			resume: (binding, signal) => phase("resume", binding, signal),
			discard: async (binding) => {
				// Inert candidates never owned live producers; their cleanup cannot gate the retained old pair.
				peer.connection.notify("desktopExtension/phase", {
					windowId: peer.windowId,
					lifetime: peer.lifetime,
					id: randomUUID(),
					phase: "discard",
					binding,
				});
			},
			revoke: () => {
				peer.subscriptions.forEach((subscription, key) => {
					if (subscription.binding.owner === id) peer.subscriptions.delete(key);
				});
				peer.connection.notify("desktopExtension/phase", {
					windowId: peer.windowId,
					lifetime: peer.lifetime,
					id: randomUUID(),
					phase: "revoke",
					binding: last ?? { owner: id, revision: "", epoch: "", window: peer.key, mount: "" },
				});
			},
		};
	}

	private phase(
		peer: Peer,
		binding: DesktopActivationBinding,
		phase: DesktopExtensionPhase["phase"],
		signal: AbortSignal,
		metadata?: Metadata,
	): Promise<void> {
		if (peer.signal.aborted) return Promise.resolve();
		if (signal.aborted) return Promise.reject(new Error("Activation revoked."));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				this.acknowledgements.delete(id);
				signal.removeEventListener("abort", cancelled);
				peer.signal.removeEventListener("abort", closed);
			};
			const cancelled = () => {
				cleanup();
				reject(new Error("Activation revoked."));
			};
			const closed = () => {
				cleanup();
				resolve();
			};
			this.acknowledgements.set(id, {
				peer,
				binding,
				settle: (error) => {
					cleanup();
					if (error !== undefined) reject(new Error(error || `Frontend ${phase} failed.`));
					else resolve();
				},
			});
			signal.addEventListener("abort", cancelled, { once: true });
			peer.signal.addEventListener("abort", closed, { once: true });
			peer.connection.notify("desktopExtension/phase", {
				windowId: peer.windowId,
				lifetime: peer.lifetime,
				id,
				binding,
				phase,
				...(metadata ? { artifact: metadata.artifact, contracts: metadata.contracts } : {}),
			});
		});
	}

	private ready(owner: Owner, peer: Peer): void {
		const binding = owner.coordinator.binding(peer.key);
		if (binding && owner.live)
			peer.connection.notify("desktopExtension/phase", {
				windowId: peer.windowId,
				lifetime: peer.lifetime,
				id: randomUUID(),
				phase: "ready",
				binding,
				artifact: owner.live.artifact,
				contracts: owner.live.contracts,
			});
	}

	private clearSubscriptions(owner: string): void {
		for (const peer of this.peers.values())
			for (const [key, subscription] of peer.subscriptions)
				if (subscription.binding.owner === owner) peer.subscriptions.delete(key);
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
