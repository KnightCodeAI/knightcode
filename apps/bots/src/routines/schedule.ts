// Schedules (spec section 12): five-field cron expressions in the routine's time zone, and one-off reminders. Runs
// come from the bot object's alarm; firings missed during an outage become one catch-up run, told it is late.

type Field = { min: number; max: number };
const FIELDS: Field[] = [
	{ min: 0, max: 59 }, // minute
	{ min: 0, max: 23 }, // hour
	{ min: 1, max: 31 }, // day of month
	{ min: 1, max: 12 }, // month
	{ min: 0, max: 6 }, // day of week (0 = Sunday; 7 also means Sunday)
];
const NAMES: Record<string, number> = {
	jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
	sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export interface Cron {
	minute: Set<number>;
	hour: Set<number>;
	day: Set<number>;
	month: Set<number>;
	weekday: Set<number>;
	/** Both day fields restricted: standard cron fires when either matches. */
	dayOr: boolean;
}

function parseField(text: string, field: Field, weekday: boolean): Set<number> {
	const values = new Set<number>();
	for (const part of text.split(",")) {
		const [range, stepText] = part.split("/");
		const step = stepText === undefined ? 1 : Number(stepText);
		if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${text}"`);
		const value = (word: string) => {
			const named = NAMES[word.toLowerCase()];
			const n = named ?? Number(word);
			if (!Number.isInteger(n)) throw new Error(`bad value "${word}"`);
			return weekday && n === 7 ? 0 : n;
		};
		let [from, to] = [field.min, field.max];
		if (range !== "*") {
			const [a, b] = range!.split("-");
			from = value(a!);
			to = b === undefined ? (stepText === undefined ? from : field.max) : value(b);
		}
		if (from < field.min || to > field.max || from > to) throw new Error(`"${text}" is out of range`);
		for (let n = from; n <= to; n += step) values.add(n);
	}
	return values;
}

export function parseCron(expression: string): Cron {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) throw new Error("a schedule needs five fields: minute hour day month weekday");
	const [minute, hour, day, month, weekday] = parts.map((part, i) => parseField(part, FIELDS[i]!, i === 4));
	return { minute: minute!, hour: hour!, day: day!, month: month!, weekday: weekday!, dayOr: parts[2] !== "*" && parts[4] !== "*" };
}

/** Wall-clock fields of `time` in `timeZone`. */
function wallClock(time: number, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		weekday: "short",
	}).formatToParts(new Date(time));
	const get = (type: string) => parts.find((part) => part.type === type)!.value;
	return {
		minute: Number(get("minute")),
		hour: Number(get("hour")),
		day: Number(get("day")),
		month: Number(get("month")),
		weekday: NAMES[get("weekday").toLowerCase()]!,
	};
}

function matches(cron: Cron, time: number, timeZone: string): boolean {
	const t = wallClock(time, timeZone);
	if (!cron.minute.has(t.minute) || !cron.hour.has(t.hour) || !cron.month.has(t.month)) return false;
	const day = cron.day.has(t.day);
	const weekday = cron.weekday.has(t.weekday);
	return cron.dayOr ? day || weekday : day && weekday;
}

const MINUTE = 60_000;

/** The first firing strictly after `after`, within a year; minute by minute in the zone, so DST is handled. */
export function nextFire(expression: string, timeZone: string, after: number): number | undefined {
	const cron = parseCron(expression);
	let time = Math.floor(after / MINUTE) * MINUTE + MINUTE;
	const limit = after + 366 * 24 * 60 * MINUTE;
	for (; time <= limit; time += MINUTE) {
		// Skip whole hours that cannot match, so a daily schedule takes a few hundred steps, not thousands.
		const t = wallClock(time, timeZone);
		if (!cron.hour.has(t.hour) || !cron.month.has(t.month)) {
			time += (59 - t.minute) * MINUTE;
			continue;
		}
		if (matches(cron, time, timeZone)) return time;
	}
	return undefined;
}

/** Whether a schedule fired between `from` (exclusive) and `to` (inclusive): one catch-up run covers them all. */
export function missedSince(expression: string, timeZone: string, from: number, to: number): boolean {
	const next = nextFire(expression, timeZone, from);
	return next !== undefined && next <= to;
}
