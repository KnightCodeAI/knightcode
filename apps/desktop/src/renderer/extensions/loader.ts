/** Server-decided frontend phases: inert preparation, gated publication and exact epoch retirement. */
import type {
	DesktopActivationBinding,
	DesktopArtifact,
	DesktopBackendContracts,
	DesktopExtensionDiagnostic,
} from "@knightcode/app-server-protocol";
import type { experimental_DesktopExtension } from "@knightcodeai/cli/desktop";
import type { Static } from "typebox";
import { FrontendActivation } from "./activation.ts";
import type { ExtensionRegistry } from "./registry.ts";

type Artifact = Static<typeof DesktopArtifact>;
type Prepared = { extension: experimental_DesktopExtension; dispose(): void };
type Preparation = { binding: DesktopActivationBinding; artifact: Artifact; contracts: DesktopBackendContracts };
type Report = (owner: string, revision: string, phase: DesktopExtensionDiagnostic["phase"], message: string) => void;
type Candidate = {
	binding: DesktopActivationBinding;
	activation: FrontendActivation;
	resources?: Prepared;
	registration?: ReturnType<ExtensionRegistry["prepare"]>;
	preparing?: Promise<void>;
	wasLive: boolean;
};

export class FrontendExtensions {
	private readonly registry: ExtensionRegistry;
	private readonly loadResources: (
		artifact: Artifact,
		signal: AbortSignal,
		activation: FrontendActivation,
	) => Promise<Prepared>;
	private readonly report: Report;
	private readonly flush: (commit: () => void) => void;
	private readonly live = new Map<string, Candidate>();
	private readonly candidates = new Map<string, Candidate>();
	constructor(
		registry: ExtensionRegistry,
		loadResources: (artifact: Artifact, signal: AbortSignal, activation: FrontendActivation) => Promise<Prepared>,
		report: Report,
		flush: (commit: () => void) => void = (commit) => commit(),
	) {
		this.registry = registry;
		this.loadResources = loadResources;
		this.report = report;
		this.flush = flush;
	}

	prepare(packet: Preparation): Promise<void> {
		const previous = this.candidates.get(packet.binding.owner);
		if (previous && sameBinding(previous.binding, packet.binding) && previous.preparing) return previous.preparing;
		if (previous) this.close(previous);
		const host = globalThis.__knightcodeDesktop;
		if (!host) return Promise.reject(new Error("Desktop window host is unavailable."));
		if (packet.artifact.owner !== packet.binding.owner || packet.artifact.revision !== packet.binding.revision)
			return Promise.reject(new Error("Prepared artifact does not match its activation binding."));
		const candidate: Candidate = {
			binding: packet.binding,
			activation: new FrontendActivation(packet.binding, host, () => this.registry.invalidate(), packet.contracts),
			wasLive: false,
		};
		this.candidates.set(packet.binding.owner, candidate);
		candidate.preparing = this.prepareCandidate(candidate, packet.artifact);
		return candidate.preparing;
	}

	async quiesce(binding: DesktopActivationBinding): Promise<void> {
		const candidate = this.candidates.get(binding.owner);
		if (!candidate || !sameBinding(candidate.binding, binding))
			throw new Error("Frontend candidate is no longer prepared.");
		await this.live.get(binding.owner)?.activation.quiesce(candidate.activation.signal);
	}

	/** The server has already committed the backend; publication failure can only revoke, never roll back. */
	publish(binding: DesktopActivationBinding): void {
		const candidate = this.candidates.get(binding.owner);
		if (!candidate || !sameBinding(candidate.binding, binding) || !candidate.registration)
			throw new Error("Frontend candidate is no longer prepared.");
		const previous = this.live.get(binding.owner);
		previous?.activation.dispose();
		try {
			candidate.activation.publish();
			this.flush(() => {
				candidate.registration!.commit();
			});
			if (candidate.activation.failure !== undefined) throw new Error(candidate.activation.failure);
			this.candidates.delete(binding.owner);
			this.live.set(binding.owner, candidate);
			if (previous) this.close(previous);
		} catch (error) {
			this.candidates.delete(binding.owner);
			this.live.delete(binding.owner);
			this.close(candidate);
			if (previous) this.close(previous);
			throw error;
		}
	}

	/** Publication/restoration is acknowledged while still gated; only authoritative ready releases actions. */
	resume(binding: DesktopActivationBinding): void {
		const current = this.live.get(binding.owner);
		if (!current || !sameBinding(current.binding, binding) || current.activation.signal.aborted)
			throw new Error("Frontend binding is no longer live.");
	}

	ready(binding: DesktopActivationBinding): void {
		const current = this.live.get(binding.owner);
		if (!current || !sameBinding(current.binding, binding)) return;
		if (current.activation.failure !== undefined) throw new Error(current.activation.failure);
		current.activation.ready();
		if (!current.wasLive) {
			current.wasLive = true;
			this.report(binding.owner, binding.revision, "active", "");
		}
	}

	discard(binding: DesktopActivationBinding): void {
		const candidate = this.candidates.get(binding.owner);
		if (!candidate || !sameBinding(candidate.binding, binding)) return;
		this.candidates.delete(binding.owner);
		this.close(candidate);
	}

	revoke(owner: string, binding?: DesktopActivationBinding): void {
		const live = this.live.get(owner);
		if (binding) {
			this.discard(binding);
			if (live && sameBinding(live.binding, binding)) {
				this.live.delete(owner);
				this.close(live);
			}
			return;
		}
		const candidate = this.candidates.get(owner);
		this.candidates.delete(owner);
		this.live.delete(owner);
		if (candidate) this.close(candidate);
		if (live) this.close(live);
	}

	dispose(): void {
		for (const owner of new Set([...this.live.keys(), ...this.candidates.keys()])) this.revoke(owner);
	}

	private async prepareCandidate(candidate: Candidate, artifact: Artifact): Promise<void> {
		let resources: Prepared | undefined;
		try {
			resources = await this.loadResources(artifact, candidate.activation.signal, candidate.activation);
			if (candidate.activation.signal.aborted || this.candidates.get(artifact.owner) !== candidate) {
				resources.dispose();
				throw new Error("Frontend preparation revoked.");
			}
			candidate.resources = resources;
			candidate.registration = this.registry.prepare(
				artifact.owner,
				resources.extension,
				artifact.revision,
				candidate.activation,
			);
		} catch (error) {
			if (this.candidates.get(artifact.owner) === candidate) this.candidates.delete(artifact.owner);
			if (!candidate.activation.signal.aborted)
				this.report(artifact.owner, artifact.revision, "load", error instanceof Error ? error.message : String(error));
			this.close(candidate);
			throw error;
		}
	}

	private close(candidate: Candidate): void {
		candidate.activation.dispose();
		const registration = candidate.registration;
		const resources = candidate.resources;
		candidate.registration = undefined;
		candidate.resources = undefined;
		try {
			if (registration) this.flush(() => registration.dispose());
		} catch (error) {
			this.report(candidate.binding.owner, candidate.binding.revision, "dispose", String(error));
		}
		try {
			resources?.dispose();
		} catch (error) {
			this.report(candidate.binding.owner, candidate.binding.revision, "dispose", String(error));
		}
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
