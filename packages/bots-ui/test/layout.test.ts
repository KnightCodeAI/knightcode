import type { Entry } from "@knightcode/bots-protocol";
import { describe, expect, it } from "vitest";
import { formatDay, formatTime, layoutEntries } from "../src/chat/layout.ts";

const at = (iso: string) => Date.parse(iso);
const msg = (id: string, createdAt: number, role: "user" | "assistant" = "assistant"): Entry => ({
	kind: "message",
	id,
	role,
	text: id,
	createdAt,
});

describe("layoutEntries", () => {
	it("puts a day stamp before the first entry of each day", () => {
		const rows = layoutEntries(
			[msg("a", at("2026-10-18T08:55:00+05:30")), msg("b", at("2026-10-19T21:24:00+05:30"))],
			"Asia/Kolkata",
		);
		expect(rows.map((r) => r.kind)).toEqual(["day", "entry", "day", "entry"]);
	});

	it("groups consecutive messages from the same speaker and gives each its place", () => {
		const t = at("2026-10-19T21:25:00+05:30");
		const rows = layoutEntries([msg("a", t), msg("b", t), msg("c", t), msg("d", t, "user")], "Asia/Kolkata");
		expect(rows.filter((r) => r.kind === "entry").map((r) => (r.kind === "entry" ? r.place : ""))).toEqual([
			"first",
			"middle",
			"last",
			"single",
		]);
	});

	it("breaks a group at a card or an event", () => {
		const t = at("2026-10-19T21:25:00+05:30");
		const rows = layoutEntries(
			[msg("a", t), { kind: "event", id: "e", text: "Renamed", createdAt: t }, msg("b", t)],
			"Asia/Kolkata",
		);
		expect(rows.filter((r) => r.kind === "entry").map((r) => (r.kind === "entry" ? r.place : ""))).toEqual([
			"single",
			"single",
			"single",
		]);
	});
});

describe("formatDay", () => {
	it("spells the day stamp like the transcript shows it", () => {
		expect(formatDay(at("2026-10-18T08:55:14+05:30"), "Asia/Kolkata")).toBe("Sun, Oct 18 8:55 AM");
		expect(formatTime(at("2026-10-19T21:24:58+05:30"), "Asia/Kolkata")).toBe("9:24 PM");
	});
});
