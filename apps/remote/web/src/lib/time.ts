const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The compact form a session list wants: "now", "24m", "3h", "3d", then a date once the
 * relative form stops meaning anything. Deliberately not Intl.RelativeTimeFormat — that
 * renders "3 days ago", which is three times the width for the same fact.
 */
export function shortAge(timestamp: number, now = Date.now()): string {
	const elapsed = Math.max(0, now - timestamp);
	if (elapsed < MINUTE) return "now";
	if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
	if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
	if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
	return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fullTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}
