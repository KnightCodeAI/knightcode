/**
 * What `<agentDir>/plugins/` holds:
 * - `state.json`: install records (identity and scope → active revision), trusted identities, cached marketplaces.
 * - `cache/<id>/<revision>/`: immutable revisions, each `plugin/` (the rendered copy) and `inventory.json`.
 * - `marketplaces/<id>/<revision>/`: catalog snapshots.
 * - `data/<id>/`: what `${CLAUDE_PLUGIN_DATA}` names. Kept on uninstall.
 * - `tmp/`: staging; a rename moves a finished revision into place.
 *
 * Every mutation of `state.json` runs under a lock, which serializes the CLI and app-server processes.
 */

import { createHash, randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import lockfile from "proper-lockfile";
import type { PluginInventory } from "./render.ts";

export interface InstallRecord {
	identity: string;
	/** Storage name: `<namespace>-<hash of identity>`. */
	id: string;
	/** `user`, or the canonical project directory. */
	scope: string;
	name: string;
	namespace: string;
	marketplace?: string;
	/** The declaration's source, ref and path as given. */
	source: string;
	ref?: string;
	path?: string;
	/** The resolved commit, or a content hash for a directory source. */
	commit: string;
	revision: string;
	installedAt: string;
}

export interface MarketplaceRecord {
	name: string;
	source: string;
	ref?: string;
	/** Identity of the catalog's source, which `name@marketplace` plugin identities build on. */
	canonical: string;
	id: string;
	commit: string;
	revision: string;
	updatedAt: string;
}

export interface PluginState {
	version: 1;
	plugins: InstallRecord[];
	/** Identities the user trusted. Trust carries across updates. */
	trusted: string[];
	marketplaces: MarketplaceRecord[];
}

export function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Copies `from` into the new directory `to`, without `.git`. Links inside the tree are copied as the files they point
 * at; a symlink or junction that leaves `from` fails the copy.
 */
export function copyContent(from: string, to: string): void {
	const root = realpathSync(from);
	const visit = (source: string, target: string, seen: Set<string>) => {
		const real = realpathSync(source);
		if (!isInside(root, real)) throw new Error(`${relative(from, source)} links outside the plugin`);
		if (statSync(real).isDirectory()) {
			if (seen.has(real)) return;
			mkdirSync(target, { recursive: true });
			const next = new Set(seen).add(real);
			for (const name of readdirSync(source)) {
				if (name === ".git") continue;
				visit(join(source, name), join(target, name), next);
			}
			return;
		}
		if (lstatSync(source).isSymbolicLink() || statSync(real).isFile()) copyFileSync(real, target);
	};
	visit(from, to, new Set());
}

/** A hash of every file's path and content under `dir`, for sources that have no commit. */
export function hashTree(dir: string): string {
	const hash = createHash("sha256");
	const walk = (path: string) => {
		for (const name of readdirSync(path).sort()) {
			const full = join(path, name);
			if (statSync(full).isDirectory()) walk(full);
			else hash.update(`${relative(dir, full).replace(/\\/g, "/")}\0`).update(readFileSync(full));
		}
	};
	walk(dir);
	return hash.digest("hex");
}

export class PluginStore {
	readonly dir: string;
	readonly statePath: string;

	constructor(agentDir: string) {
		this.dir = join(agentDir, "plugins");
		this.statePath = join(this.dir, "state.json");
	}

	revisionDir(id: string, revision: string): string {
		return join(this.dir, "cache", id, revision);
	}

	pluginRoot(id: string, revision: string): string {
		return join(this.revisionDir(id, revision), "plugin");
	}

	dataDir(id: string): string {
		return join(this.dir, "data", id);
	}

	marketplaceRoot(id: string, revision: string): string {
		return join(this.dir, "marketplaces", id, revision);
	}

	/** A fresh staging directory, removed by the caller. */
	tempDir(): string {
		const dir = join(this.dir, "tmp", randomUUID());
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	readInventory(id: string, revision: string): PluginInventory | undefined {
		const path = join(this.revisionDir(id, revision), "inventory.json");
		if (!existsSync(path)) return undefined;
		try {
			return JSON.parse(readFileSync(path, "utf-8")) as PluginInventory;
		} catch {
			return undefined;
		}
	}

	read(): PluginState {
		if (!existsSync(this.statePath)) return { version: 1, plugins: [], trusted: [], marketplaces: [] };
		const parsed = JSON.parse(readFileSync(this.statePath, "utf-8")) as Partial<PluginState>;
		return {
			version: 1,
			plugins: parsed.plugins ?? [],
			trusted: parsed.trusted ?? [],
			marketplaces: parsed.marketplaces ?? [],
		};
	}

	/** Writes through a temporary file and a rename, so readers see the old or the new state, never half of one. */
	write(state: PluginState): void {
		mkdirSync(this.dir, { recursive: true });
		const temp = `${this.statePath}.${randomUUID()}.tmp`;
		writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
		renameSync(temp, this.statePath);
	}

	/** Moves a staged revision into place unless that revision already exists; revisions never change. */
	commitRevision(staged: string, target: string): void {
		if (existsSync(target)) {
			rmSync(staged, { recursive: true, force: true });
			return;
		}
		mkdirSync(join(target, ".."), { recursive: true });
		renameSync(staged, target);
	}

	/** Runs `fn` holding the state lock. */
	async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
		mkdirSync(this.dir, { recursive: true });
		const release = await lockfile.lock(this.statePath, {
			realpath: false,
			stale: 30_000,
			retries: { retries: 600, factor: 1, minTimeout: 100, maxTimeout: 200 },
		});
		try {
			return await fn();
		} finally {
			await release();
		}
	}
}
