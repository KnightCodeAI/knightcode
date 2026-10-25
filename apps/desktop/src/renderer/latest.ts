/**
 * Polls `read` one call at a time: the next starts `interval` ms after the last one answered, so answers arrive in
 * the order they were asked and a slow one never lands after a newer one. `onAnswer` says whether to go on; a failed
 * read ends the polling through `onError`. The returned stop drops whatever is still on its way.
 */
export function pollInOrder<T>(
	interval: number,
	read: () => Promise<T>,
	onAnswer: (answer: T) => boolean,
	onError: (error: unknown) => void,
): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const next = () => {
		// A read that throws before it returns a promise fails like one that rejects.
		Promise.resolve()
			.then(read)
			.then(
				(answer) => {
					if (!stopped && onAnswer(answer)) timer = setTimeout(next, interval);
				},
				(error: unknown) => {
					if (!stopped) onError(error);
				},
			);
	};
	next();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

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
