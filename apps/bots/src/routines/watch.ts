// Watch for changes (spec section 12): check a connected app's read tool, a file or folder, or a command's output, and
// run only when the result changed (optionally posting "No changes" otherwise). Connector checks run in the Durable
// Object without waking the computer. File and command checks need the computer: they run when it is already awake,
// and otherwise at most once an hour, so a 5-minute check cannot keep the computer up around the clock.
import type { Trigger } from "@knightcode/bots-protocol";

type Watch = Extract<Trigger, { kind: "watch" }>;

export const HOUR_MS = 60 * 60_000;

/** When a watch is next due, given its last check and whether the computer is awake right now. */
export function nextCheck(watch: Watch, lastCheckedAt: number, computerAwake: boolean): number {
	const every = Math.max(5, watch.everyMinutes) * 60_000;
	if (watch.target === "connector" || computerAwake) return lastCheckedAt + every;
	return lastCheckedAt + Math.max(every, HOUR_MS);
}

/** Computer hours a file or command watch costs per day at most (shown in the routine editor). */
export function computerHoursPerDay(watch: Watch): number {
	if (watch.target === "connector") return 0;
	// Each check that wakes the computer keeps it up for its 10-minute idle time.
	const checksPerDay = (24 * 60) / Math.max(watch.everyMinutes, 60);
	return Math.round(checksPerDay * (10 / 60) * 10) / 10;
}

async function digest(text: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The outcome of one check: fire with the new result, post "No changes", or stay quiet. */
export async function compareCheck(
	watch: Watch,
	previousDigest: string | undefined,
	result: string,
): Promise<{ digest: string; action: "fire" | "no_changes" | "quiet" }> {
	const current = await digest(result);
	if (previousDigest === undefined) return { digest: current, action: "quiet" };
	if (current !== previousDigest) return { digest: current, action: "fire" };
	return { digest: current, action: watch.postNoChanges ? "no_changes" : "quiet" };
}
