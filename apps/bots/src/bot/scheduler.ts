// When a bot object's alarm should next fire (spec section 12): a recovery heartbeat while work runs, the harness's
// earliest sleep, and the bot's routine deadlines, whichever comes first.
import type { Wake } from "@knightcode/durable";

export function nextAlarm(input: {
	wake: Wake;
	routineDeadlines: number[];
	now: number;
	heartbeatMs: number;
}): number | undefined {
	const { wake, routineDeadlines, now, heartbeatMs } = input;
	const times = [...routineDeadlines, ...(wake.at === undefined ? [] : [wake.at])];
	if (wake.active) times.push(now + heartbeatMs);
	return times.length ? Math.min(...times) : undefined;
}
