import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute, type Route } from "../src/shell/routes.ts";

describe("routes", () => {
	it("round-trips every screen's path", () => {
		const paths = [
			"/",
			"/bots/reviewer",
			"/bots/reviewer?pane=closed",
			"/bots/reviewer/settings",
			"/bots/reviewer/memory",
			"/bots/reviewer/computer",
			"/bots/reviewer/library",
			"/bots/reviewer/routines",
			"/bots/reviewer/routines/new",
			"/bots/reviewer/routines/rt-1",
			"/groups/launch",
			"/groups/new",
			"/groups/launch?pane=closed",
			"/groups/launch?pane=details",
			"/groups/launch?pane=library",
			"/groups/launch?pane=members",
			"/new",
			"/new?tab=templates",
			"/connectors",
			"/connectors/gmail",
			"/skills",
			"/settings/billing",
			"/inbox",
			"/activity",
			"/pages",
			"/pages/weekly",
		];
		for (const path of paths) {
			const [pathname, search = ""] = path.split("?");
			expect(formatRoute(parseRoute(pathname!, search ? `?${search}` : "")), path).toBe(path);
		}
	});

	it("treats unknown paths as not found", () => {
		expect(parseRoute("/nope")).toEqual({ name: "not-found", path: "/nope" } satisfies Route);
		expect(parseRoute("/groups/launch/settings")).toEqual({
			name: "not-found",
			path: "/groups/launch/settings",
		} satisfies Route);
	});
});
