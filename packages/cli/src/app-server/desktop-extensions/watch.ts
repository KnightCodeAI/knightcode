/** Per-process directory watches only for explicitly approved, enabled development sources. */
import { watch, type FSWatcher } from "node:fs";
import type { ResultOf } from "@knightcode/app-server-protocol";

export class DesktopDevelopmentWatcher {
	private readonly watches = new Map<string, FSWatcher>();
	private readonly changed: () => void;
	private pending: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(changed: () => void) {
		this.changed = changed;
	}

	update(status: ResultOf<"desktopExtension/list">): void {
		if (this.disposed) return;
		const sources = new Set(
			status.safeMode || !status.preview
				? []
				: status.extensions
						.filter((entry) => entry.approved && entry.enabled && entry.dev)
						.map((entry) => entry.source),
		);
		for (const [source, watcher] of this.watches) {
			if (sources.has(source)) continue;
			watcher.close();
			this.watches.delete(source);
		}
		for (const source of sources) {
			if (this.watches.has(source)) continue;
			try {
				const watcher = watch(source, { recursive: true, persistent: false }, () => this.schedule());
				watcher.on("error", () => {
					watcher.close();
					this.watches.delete(source);
					this.schedule();
				});
				this.watches.set(source, watcher);
			} catch {
				// Filesystem boundary: a development directory can disappear between discovery and watching.
				this.schedule();
			}
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const watcher of this.watches.values()) watcher.close();
		this.watches.clear();
		if (this.pending) clearTimeout(this.pending);
	}

	private schedule(): void {
		if (this.disposed) return;
		if (this.pending) clearTimeout(this.pending);
		this.pending = setTimeout(() => {
			this.pending = undefined;
			this.changed();
		}, 100);
		this.pending.unref();
	}
}
