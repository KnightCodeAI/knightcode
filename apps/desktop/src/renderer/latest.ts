/**
 * Checks of a value the user is still editing (the handoff dialog's branch): `check` runs for the latest key only,
 * `delay` ms after keys stop changing, and an answer for a key that is no longer the latest is dropped, so a slow
 * check of an old value never overrides a newer one.
 */
export function latestCheck<T>(
	delay: number,
	check: (key: string) => Promise<T>,
	onAnswer: (key: string, answer: T) => void,
): { set(key: string): void; stop(): void } {
	let latest: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		set(key) {
			if (key === latest) return;
			latest = key;
			clearTimeout(timer);
			timer = setTimeout(() => {
				void check(key).then((answer) => {
					if (key === latest) onAnswer(key, answer);
				});
			}, delay);
		},
		stop() {
			latest = undefined;
			clearTimeout(timer);
		},
	};
}
