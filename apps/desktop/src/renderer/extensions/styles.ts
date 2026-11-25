/** Revision stylesheet leases; mounted roots and portals retain their rules until React unmounts them. */
import type { DesktopArtifact } from "@knightcode/app-server-protocol";
import type { Static } from "typebox";

type Artifact = Static<typeof DesktopArtifact>;
type Sheet = { count: number; links: HTMLLinkElement[]; ready: Promise<void>; onRelease(): void };
const sheets = new Map<string, Sheet>();

export function artifactUrl(artifact: Pick<Artifact, "owner" | "revision">, path: string): string {
	return `app://ext/${artifact.owner}/${artifact.revision}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Acquire before loading the module. Candidate styles remain inert until roots carry its revision. */
export async function loadRevisionStyles(
	artifact: Artifact,
	signal: AbortSignal,
	acquire: () => Promise<() => void>,
): Promise<() => void> {
	const key = `${artifact.owner}/${artifact.revision}`;
	let sheet = sheets.get(key);
	if (!sheet) {
		const links: HTMLLinkElement[] = [];
		const acquired = acquire();
		const record: Sheet = {
			count: 0,
			links,
			ready: acquired.then(() => {
				// Cancellation may retire this lifetime while main is still admitting its lease.
				if (record.count === 0) return;
				return Promise.all(
					artifact.styles.map(
						(path, index) =>
							new Promise<void>((resolve, reject) => {
								const link = document.createElement("link");
								links.push(link);
								link.rel = "stylesheet";
								link.href = artifactUrl(artifact, path);
								link.crossOrigin = "anonymous";
								link.dataset.kcStyles = `${key}/${index}`;
								link.onload = () => resolve();
								link.onerror = () => reject(new Error(`Failed to load extension CSS: ${path}`));
								const before = [...document.querySelectorAll<HTMLLinkElement>("link[data-kc-styles]")].find(
									(other) => other.dataset.kcStyles! > link.dataset.kcStyles!,
								);
								document.head.insertBefore(link, before ?? null);
							}),
					),
				).then(() => {});
			}),
			onRelease: () => {
				void acquired.then(
					(release) => release(),
					() => {},
				);
			},
		};
		sheet = record;
		sheets.set(key, sheet);
	}
	const release = retainRevisionStyles(artifact.owner, artifact.revision);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort: () => void = () => {};
	try {
		await Promise.race([
			sheet.ready,
			new Promise<never>((_resolve, reject) => {
				abort = () => reject(new Error("Extension stylesheet preparation cancelled."));
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
				timer = setTimeout(() => reject(new Error("Extension stylesheet readiness timed out.")), 10_000);
			}),
		]);
		return release;
	} catch (error) {
		release();
		throw error;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
	}
}

/** A root's original owner/revision survives nested replacement UI and out-of-tree portals. */
export function retainRevisionStyles(owner: string, revision: string | undefined): () => void {
	const key = `${owner}/${revision}`;
	const sheet = sheets.get(key);
	if (!sheet) return () => {};
	sheet.count++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--sheet.count !== 0) return;
		for (const link of sheet.links) link.remove();
		sheets.delete(key);
		sheet.onRelease();
	};
}
