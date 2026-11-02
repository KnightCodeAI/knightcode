// apps/bots/test/scheduler.test.ts
import { expect, it } from "vitest";
import { nextAlarm } from "../src/bot/scheduler.ts";

it("arms the earliest of heartbeat, sleep and routine deadline", () => {
	expect(nextAlarm({ wake: { active: true, at: 5_000 }, routineDeadlines: [9_000], now: 0, heartbeatMs: 60_000 })).toBe(5_000);
	expect(nextAlarm({ wake: { active: false }, routineDeadlines: [], now: 0, heartbeatMs: 60_000 })).toBeUndefined();
	// A routine due before the sleep, and a heartbeat before both.
	expect(nextAlarm({ wake: { active: false, at: 5_000 }, routineDeadlines: [3_000], now: 0, heartbeatMs: 60_000 })).toBe(3_000);
	expect(nextAlarm({ wake: { active: true, at: 90_000 }, routineDeadlines: [], now: 1_000, heartbeatMs: 60_000 })).toBe(61_000);
});
