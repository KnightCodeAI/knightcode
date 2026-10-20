import { expect, test } from "vitest";
import { threadLink, viewOfLink } from "../../src/renderer/routes.ts";

test("a thread's link opens that thread, its id escaped both ways", () => {
	expect(viewOfLink(threadLink("a b/c"))).toEqual({ kind: "thread", id: "a b/c" });
	expect(viewOfLink("knightcode://thread/019a")).toEqual({ kind: "thread", id: "019a" });
});

test("new-thread and settings links", () => {
	expect(viewOfLink("knightcode://new?cwd=C%3A%5Cwork")).toEqual({ kind: "new", cwd: "C:\\work" });
	expect(viewOfLink("knightcode://new")).toEqual({ kind: "new" });
	expect(viewOfLink("knightcode://settings/archived")).toEqual({ kind: "settings", page: "archived" });
	expect(viewOfLink("knightcode://settings")).toEqual({ kind: "settings", page: "general" });
});

test("anything else is ignored", () => {
	for (const link of ["knightcode://settings/nope", "knightcode://thread", "https://thread/x", "not a url"])
		expect(viewOfLink(link), link).toBeUndefined();
});
