/** Per-window frontend revisions: prepare first, retain the working set on failure, refuse late publication. */
import type { DesktopArtifact, DesktopExtensionDiagnostic, ResultOf } from "@knightcode/app-server-protocol";
import type { experimental_DesktopExtension, experimental_Disposable } from "@knightcodeai/cli/desktop";
import type { Static } from "typebox";
import type { ExtensionRegistry } from "./registry.ts";

type Artifact = Static<typeof DesktopArtifact>;
type Prepared = { extension: experimental_DesktopExtension; dispose(): void };
type Report = (owner: string, revision: string, phase: DesktopExtensionDiagnostic["phase"], message: string) => void;

export class FrontendExtensions {
	private readonly registry: ExtensionRegistry;
	private readonly prepare: (artifact: Artifact, signal: AbortSignal) => Promise<Prepared>;
	private readonly report: Report;
	private readonly publish: (commit: () => void) => void;
	private readonly live = new Map<
		string,
		{ revision: string; registration: experimental_Disposable; resources: Prepared }
	>();
	private generation = new AbortController();
	constructor(
		registry: ExtensionRegistry,
		prepare: (artifact: Artifact, signal: AbortSignal) => Promise<Prepared>,
		report: Report,
		publish: (commit: () => void) => void = (commit) => commit(),
	) {
		this.registry = registry;
		this.prepare = prepare;
		this.report = report;
		this.publish = publish;
	}

	async update(snapshot: ResultOf<"desktopExtension/list">, reason: "changed" | "reload" = "changed"): Promise<void> {
		this.generation.abort();
		const generation = new AbortController();
		this.generation = generation;
		const desired = new Set(
			snapshot.safeMode
				? []
				: snapshot.extensions.filter((entry) => entry.enabled && entry.approved).map((entry) => entry.owner),
		);
		for (const [owner, entry] of this.live)
			if (!desired.has(owner)) {
				this.publish(() => entry.registration.dispose());
				entry.resources.dispose();
				this.live.delete(owner);
			}
		if (snapshot.safeMode) return;
		for (const entry of snapshot.extensions) {
			if (generation.signal.aborted) return;
			const artifact = entry.artifact;
			if (!desired.has(entry.owner)) continue;
			if (entry.error) this.report(entry.owner, entry.revision ?? "unknown", "load", entry.error);
			if (!artifact || (reason === "changed" && this.live.get(entry.owner)?.revision === artifact.revision)) continue;
			let resources: Prepared | undefined;
			try {
				resources = await this.prepare(artifact, generation.signal);
				if (generation.signal.aborted) {
					resources.dispose();
					return;
				}
				const candidate = this.registry.prepare(entry.owner, resources.extension, artifact.revision);
				const previous = this.live.get(entry.owner);
				let registration!: experimental_Disposable;
				this.report(entry.owner, artifact.revision, "active", "");
				try {
					this.publish(() => {
						registration = candidate.commit();
					});
				} catch (error) {
					candidate.dispose();
					throw error;
				}
				this.live.set(entry.owner, { revision: artifact.revision, registration, resources });
				previous?.resources.dispose();
			} catch (error) {
				resources?.dispose();
				if (!generation.signal.aborted)
					this.report(entry.owner, artifact.revision, "load", error instanceof Error ? error.message : String(error));
			}
		}
	}

	dispose(): void {
		this.generation.abort();
		for (const entry of this.live.values()) {
			this.publish(() => entry.registration.dispose());
			entry.resources.dispose();
		}
		this.live.clear();
	}
}
