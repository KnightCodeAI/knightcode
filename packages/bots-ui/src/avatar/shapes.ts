// The outline of every avatar shape: a stock bot-avatars type where one fits, otherwise a KnightCode-drawn path.
import type { AvatarShape } from "@knightcode/bots-protocol";
import type { BotAvatarType } from "bot-avatars";

/** How one shape is drawn: a stock type, or a custom path (100 x 100 box centred on 50,50) placed like `type`. */
export interface ShapeOutline {
	type: BotAvatarType;
	path?: string;
}

/** Every named shape, drawn. */
export const SHAPE_OUTLINES: Record<AvatarShape, ShapeOutline> = {
	blob: { type: "blob" },
	pebble: { type: "pebble" },
	bean: {
		type: "blob",
		path: "M38 14 C60 8 86 22 88 48 C90 74 70 90 48 88 C28 86 12 72 14 54 C15 44 24 40 30 34 C34 30 30 18 38 14 Z",
	},
	egg: { type: "circle", path: "M50 10 C72 10 86 42 86 62 C86 80 70 92 50 92 C30 92 14 80 14 62 C14 42 28 10 50 10 Z" },
	squircle: {
		type: "square",
		path: "M50 12 C82 12 88 18 88 50 C88 82 82 88 50 88 C18 88 12 82 12 50 C12 18 18 12 50 12 Z",
	},
	tablet: { type: "square", path: "M36 10 H64 Q78 10 78 24 V76 Q78 90 64 90 H36 Q22 90 22 76 V24 Q22 10 36 10 Z" },
	capsule: { type: "pill" },
	cylinder: { type: "pill", path: "M18 26 C18 12 82 12 82 26 V74 C82 88 18 88 18 74 Z" },
	hex: { type: "hexagon" },
	gem: {
		type: "circle",
		path: roundedPolygon(
			[
				[30, 16],
				[70, 16],
				[90, 40],
				[50, 90],
				[10, 40],
			],
			7,
		),
	},
	crystal: {
		type: "hexagon",
		path: roundedPolygon(
			[
				[50, 6],
				[78, 28],
				[78, 72],
				[50, 94],
				[22, 72],
				[22, 28],
			],
			8,
		),
	},
	wedge: { type: "triangle" },
	shield: {
		type: "circle",
		path: "M50 10 Q53 10 56 11 L80 19 Q86 21 86 27 V48 C86 70 70 84 54 91 Q50 93 46 91 C30 84 14 70 14 48 V27 Q14 21 20 19 L44 11 Q47 10 50 10 Z",
	},
	dome: { type: "circle", path: "M12 78 C12 36 30 16 50 16 C70 16 88 36 88 78 Q88 88 78 88 H22 Q12 88 12 78 Z" },
	arch: {
		type: "square",
		path: "M22 82 V46 C22 26 34 12 50 12 C66 12 78 26 78 46 V82 Q78 90 70 90 H30 Q22 90 22 82 Z",
	},
	cloud: { type: "cloud" },
	teardrop: { type: "drop" },
	leaf: { type: "drop", path: "M50 8 C78 28 86 60 50 92 C14 60 22 28 50 8 Z" },
	square: { type: "square" },
	sparkle: { type: "star", path: "M50 6 C54 36 64 46 94 50 C64 54 54 64 50 94 C46 64 36 54 6 50 C36 46 46 36 50 6 Z" },
	clover: { type: "clover" },
	flower: { type: "flower" },
	heart: {
		type: "circle",
		path: "M50 88 C26 70 10 56 10 36 C10 22 21 12 33 12 C41 12 47 16 50 22 C53 16 59 12 67 12 C79 12 90 22 90 36 C90 56 74 70 50 88 Z",
	},
	house: {
		type: "square",
		path: roundedPolygon(
			[
				[50, 10],
				[88, 42],
				[88, 90],
				[12, 90],
				[12, 42],
			],
			8,
		),
	},
	star: { type: "star" },
};

/** A closed SVG path through `points` with every corner rounded by `radius` (clamped to half of each side). */
export function roundedPolygon(points: readonly (readonly [number, number])[], radius: number): string {
	const n = points.length;
	const corner = (i: number) => {
		const [x, y] = points[i]!;
		const [px, py] = points[(i + n - 1) % n]!;
		const [nx, ny] = points[(i + 1) % n]!;
		const toward = (tx: number, ty: number) => {
			const length = Math.hypot(tx - x, ty - y);
			const r = Math.min(radius, length / 2);
			return [x + ((tx - x) * r) / length, y + ((ty - y) * r) / length] as const;
		};
		return { at: [x, y] as const, from: toward(px, py), to: toward(nx, ny) };
	};
	const corners = points.map((_, i) => corner(i));
	const fmt = (v: number) => Math.round(v * 100) / 100;
	const parts = corners.map(
		({ at, from, to }, i) =>
			`${i === 0 ? "M" : "L"}${fmt(from[0])} ${fmt(from[1])} Q${at[0]} ${at[1]} ${fmt(to[0])} ${fmt(to[1])}`,
	);
	return `${parts.join(" ")} Z`;
}
