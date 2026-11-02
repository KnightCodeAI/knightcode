// Account resource limits (spec section 16): defaults the beta tunes.
export const ACCOUNT_LIMITS = {
	/** Bot runs in flight at once across the account. */
	concurrentRuns: 5,
	/** Helpers one run may start. */
	helperFanOut: 4,
	/** Runs one routine may start in a minute; more are dropped. */
	triggersPerMinute: 30,
	/** Stored data across files, pages and memory. */
	storedBytes: 10 * 1024 ** 3,
} as const;

export type LimitName = keyof typeof ACCOUNT_LIMITS;

/** Whether one more (of `adding`) still fits under `name`'s limit. */
export const withinLimit = (name: LimitName, current: number, adding = 1) => current + adding <= ACCOUNT_LIMITS[name];
