import { describe, expect, it } from "vitest";
import { runDuration } from "../src/routines/RunHistory.tsx";
import { TRIGGER_KINDS } from "../src/routines/TriggerPicker.tsx";

describe("routines", () => {
	it("offers all seven trigger kinds, each starting as its own kind", () => {
		expect(TRIGGER_KINDS.map((k) => k.kind)).toEqual([
			"schedule",
			"github",
			"slack",
			"email",
			"composio",
			"webhook",
			"watch",
		]);
		for (const k of TRIGGER_KINDS) expect(k.start().kind).toBe(k.kind);
	});
	it("formats run durations in seconds, minutes and hours", () => {
		expect(runDuration({ startedAt: 0, endedAt: 42_000 })).toBe("42s");
		expect(runDuration({ startedAt: 0, endedAt: 250_000 })).toBe("4m 10s");
		expect(runDuration({ startedAt: 0, endedAt: 3_720_000 })).toBe("1h 2m");
		expect(runDuration({ startedAt: 0 }, 5_000)).toBe("5s");
	});
});
