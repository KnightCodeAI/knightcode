// packages/bots-ui/test/avatar.test.ts
import { AVATAR_SHAPES } from "@knightcode/bots-protocol";
import { expect, it } from "vitest";
import { roundedPolygon, SHAPE_OUTLINES } from "../src/avatar/shapes.ts";

it("draws every avatar shape", () => {
	for (const shape of AVATAR_SHAPES) expect(SHAPE_OUTLINES[shape], shape).toBeDefined();
});

it("rounds polygon corners into a closed path", () => {
	const path = roundedPolygon(
		[
			[0, 0],
			[100, 0],
			[100, 100],
		],
		10,
	);
	expect(path.startsWith("M")).toBe(true);
	expect(path.endsWith("Z")).toBe(true);
	expect(path.match(/Q/g)).toHaveLength(3);
	expect(path).toContain("Q100 0 100 10");
});
