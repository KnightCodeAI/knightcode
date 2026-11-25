/** Bound staged history without deleting revisions leased by any live desktop or app server. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { stageDesktopRevision, type DesktopArtifact } from "./artifacts.ts";

export type ArtifactLease = { release(): void };
const receipt = Compile(Type.Object({ pid: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }));
const HISTORY = 3;

/** Retain a staged revision for a review, candidate, backend, or native serving lease. */
export function retainDesktopArtifact(root: string): ArtifactLease {
	const path = join(root, `.lease-${process.pid}-${randomUUID()}.json`);
	writeFileSync(path, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
	let released = false;
	return {
		release() {
			if (released) return;
			released = true;
			rmSync(path, { force: true });
		},
	};
}

/** Staging and pruning share a filesystem lock, so a revision is leased before another process can prune it. */
export class DesktopArtifactCache {
	private readonly root: string;
	constructor(root: string) {
		this.root = root;
	}

	async stage(source: string, owner: string): Promise<{ artifact: DesktopArtifact; lease: ArtifactLease }> {
		mkdirSync(this.root, { recursive: true });
		const unlock = await lockfile.lock(this.root, { retries: { retries: 20, minTimeout: 10, maxTimeout: 100 } });
		try {
			const artifact = await stageDesktopRevision(source, this.root, owner);
			const created = join(artifact.root, ".staged");
			if (!existsSync(created)) writeFileSync(created, "", { mode: 0o600 });
			const lease = retainDesktopArtifact(artifact.root);
			try {
				this.prune();
			} catch (error) {
				lease.release();
				throw error;
			}
			return { artifact, lease };
		} finally {
			await unlock();
		}
	}

	private prune(): void {
		for (const owner of readdirSync(this.root, { withFileTypes: true })) {
			if (!owner.isDirectory() || owner.name.startsWith(".")) continue;
			const history = readdirSync(join(this.root, owner.name), { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
				.map((entry) => ({
					path: join(this.root, owner.name, entry.name),
					time: existsSync(join(this.root, owner.name, entry.name, ".staged"))
						? statSync(join(this.root, owner.name, entry.name, ".staged")).mtimeMs
						: statSync(join(this.root, owner.name, entry.name)).birthtimeMs,
				}))
				.sort((a, b) => b.time - a.time || a.path.localeCompare(b.path));
			let unleased = 0;
			for (const entry of history) {
				if (leased(entry.path)) continue;
				if (unleased++ >= HISTORY) rmSync(entry.path, { recursive: true, force: true });
			}
		}
	}
}

function leased(root: string): boolean {
	for (const file of readdirSync(root)) {
		if (!/^\.lease-\d+-[a-f0-9-]+\.json$/.test(file)) continue;
		const path = join(root, file);
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			// Receipt files are a filesystem trust boundary. A concurrently released receipt is not a live lease.
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			return true;
		}
		if (!receipt.Check(value)) return true;
		try {
			process.kill(value.pid, 0);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") return true;
			rmSync(path, { force: true });
		}
	}
	return false;
}
