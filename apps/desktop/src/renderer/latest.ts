/**
 * Checks of a value the user is still editing (the handoff dialog's branch): `check` runs for the latest key only,
 * `delay` ms after keys stop changing, and only the latest check's answer counts, so a slow check of an old value (or
 * an earlier check of the same one) never overrides a newer one.
 */
export function latestCheck<T>(
	delay: number,
	check: (key: string) => Promise<T>,
	onAnswer: (key: string, answer: T) => void,
): { set(key: string): void; refresh(): void; stop(): void } {
	let latest: string | undefined;
	let run = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = (key: string) => {
		latest = key;
		const mine = ++run;
		clearTimeout(timer);
		timer = setTimeout(() => {
			void check(key).then((answer) => {
				if (mine === run) onAnswer(key, answer);
			});
		}, delay);
	};
	return {
		set(key) {
			if (key !== latest) schedule(key);
		},
		/** Check the latest key again: what it is checked against (the checkouts) can change under an unchanged key. */
		refresh() {
			if (latest !== undefined) schedule(latest);
		},
		stop() {
			latest = undefined;
			run++;
			clearTimeout(timer);
		},
	};
}
