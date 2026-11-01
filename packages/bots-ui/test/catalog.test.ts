import type { CatalogEntry } from "@knightcode/bots-protocol";
import { describe, expect, it } from "vitest";
import { catalogSections } from "../src/connectors/Catalog.tsx";

const app = (id: string, category: CatalogEntry["category"], connected = false): CatalogEntry => ({
	id,
	name: id,
	maker: id,
	category,
	icon: id,
	description: "",
	auth: "oauth",
	skills: [],
	permissions: { reads: "auto", writes: "approval", tools: {} },
	...(connected ? { connection: { status: "connected" as const, connectedAt: 0 } } : {}),
});

describe("catalogSections", () => {
	const entries = [
		app("gh", "developer", true),
		...["a", "b", "c", "d", "e", "f", "g"].map((id) => app(id, "data")),
		...["p1", "p2", "p3", "p4", "p5", "p6", "p7"].map((id) => app(id, "productivity")),
	];
	it("shows each app once in All: six recommended first, then categories without them", () => {
		const sections = catalogSections(entries, ["developer", "productivity", "data"], "all");
		expect(sections.map((s) => [s.id, s.entries.map((e) => e.id), s.more])).toEqual([
			["recommended", ["a", "b", "c", "d", "e", "f"], true],
			["developer", ["gh"], false],
			["productivity", ["p1", "p2", "p3", "p4", "p5", "p6"], true],
			["data", ["g"], false],
		]);
	});
	it("lists everything under a single filter", () => {
		expect(catalogSections(entries, [], "productivity")[0]!.entries).toHaveLength(7);
		expect(catalogSections(entries, [], "connected")[0]!.entries.map((e) => e.id)).toEqual(["gh"]);
		expect(catalogSections(entries, [], "recommended")[0]!.entries).toHaveLength(14);
	});
});
