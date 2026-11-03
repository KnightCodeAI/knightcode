// Shapes as 3D bodies: how each is built, how it projects to a silhouette, and where its eyes sit on its surface.
import { HEART_RING } from "./data/outlines.ts";
import type { Eye } from "./face.ts";
import type { Body } from "./motion.ts";
import { CENTRE, type DrawnShape, flatten, outline, outlinePoints, teardropOutline, wedgeOutline } from "./outlines.ts";
import { TAU, type Vec2 } from "./math.ts";

const L = CENTRE;

export interface Point3 {
	x: number;
	y: number;
	z: number;
}
interface Point2 {
	x: number;
	y: number;
}
/** A sphere [x, y, z, radius] in unit body space. */
type Ball = [number, number, number, number];

type Silhouette =
	| { kind: "solid"; samples: Point3[]; balls: Ball[]; isLoop: boolean; yawPeriod: number | null }
	| { kind: "extrusion"; rings: Point3[][]; isConvex: boolean }
	| { kind: "loft"; rings: Point3[][] };

interface WrapSeat {
	kind: "wrap";
	wrapR: number;
	wrapY0: number;
	wrapY1: number;
	eyeY: number;
	radiusAt?: (y: number) => number;
	puffAt?: (x: number, y: number) => { x: number; y: number; z: number; r: number };
}

/** How the eyes attach: printed on a flat front, on a lofted surface, or wrapped around a body of revolution. */
type Seat =
	| { kind: "front"; faceZ: number }
	| { kind: "loft"; surfaceZ: (x: number, y: number) => number }
	| WrapSeat
	| { kind: "wrapX"; wrapR: number; wrapX0: number; wrapX1: number; radiusAtX: (x: number) => number };

export interface BodyModel {
	/** The body's size relative to the sphere. */
	size: number;
	silhouette: Silhouette;
	seat: Seat | null;
}

export type ShapedBody = Exclude<Body, "sphere">;

const EXTRUSION_DEPTH = 0.36;
const EXTRUSION_BEVEL = 0.22;
const BEVEL_STEPS = 4;
const COLLINEAR = 1e-12;
const RING_SEGMENTS = 64;
const PILL_BALLS = 33;
const BALL_GRID = 40;
const LOFT_EXPONENT = 0.72;
const LOFT_RINGS = 16;
const LOFT_SAMPLES = 160;
const SURFACE_ANGLES = 180;
const WIDTH_BUCKETS = 64;
const WIDTH_PAD = 1e-5;

const toUnit = (points: Vec2[]): Point3[] => points.map(([x, y]) => ({ x: (x - L) / L, y: -(y - L) / L, z: 0 }));

function boundsOfRing(name: DrawnShape) {
	let x0 = Infinity;
	let x1 = -Infinity;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (const [x, y] of outline(name).ring) {
		if (x < x0) x0 = x;
		if (x > x1) x1 = x;
		if (y < y0) y0 = y;
		if (y > y1) y1 = y;
	}
	return { x0, x1, y0, y1 };
}

const solid = (samples: Point3[]): Silhouette => ({
	kind: "solid",
	samples,
	balls: [],
	isLoop: false,
	yawPeriod: null,
});
/** A body of revolution: its silhouette repeats every ring segment of yaw. */
const revolved = (samples: Point3[]): Silhouette => ({
	kind: "solid",
	samples,
	balls: [],
	isLoop: false,
	yawPeriod: 360 / RING_SEGMENTS,
});
const balls = (list: Ball[]): Silhouette => ({
	kind: "solid",
	samples: [],
	balls: list,
	isLoop: false,
	yawPeriod: null,
});

const revolvedBody = (size: number, name: DrawnShape): BodyModel => ({
	size,
	silhouette: revolved(revolveSamples(outlinePoints(name))),
	seat: wrapSeat(name, []),
});

function revolvedWithBelt(name: DrawnShape, eyeAt: (top: number, bottom: number) => number): BodyModel {
	const shape = outline(name);
	const top = -(shape.top - L) / L;
	const bottom = -(shape.bottom - L) / L;
	return {
		size: 1.17,
		silhouette: revolved(revolveSamples(outlinePoints(name))),
		seat: {
			kind: "wrap",
			wrapR: shape.beltRadius / L,
			wrapY0: bottom,
			wrapY1: top,
			eyeY: eyeAt(top, bottom),
			radiusAt: radiusAtY(outlinePoints(name)),
		},
	};
}

const extruded = (size: number, ring: Point3[]): BodyModel => extrusion(size, ring, EXTRUSION_DEPTH, EXTRUSION_BEVEL);

function extrusion(size: number, ring: Point3[], depth: number, bevel: number): BodyModel {
	return {
		size,
		silhouette: { kind: "extrusion", rings: bevelRings(ring, depth, bevel), isConvex: isConvex(ring) },
		seat: { kind: "front", faceZ: depth },
	};
}

function isConvex(ring: Point3[]): boolean {
	let turn = 0;
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i]!;
		const b = ring[(i + 1) % ring.length]!;
		const c = ring[(i + 2) % ring.length]!;
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (!(Math.abs(cross) < COLLINEAR)) {
			if (turn === 0) turn = Math.sign(cross);
			else if (Math.sign(cross) !== turn) return false;
		}
	}
	return true;
}

function lofted(size: number, ring: Point2[], depth: number): BodyModel {
	const loft = loftRings(ring, depth);
	return { size, silhouette: { kind: "loft", rings: loft.rings }, seat: { kind: "loft", surfaceZ: loftSurface(loft) } };
}

function wrapSeat(name: DrawnShape, puffs: Ball[]): WrapSeat {
	const shape = outline(name);
	const bottom = -(shape.bottom - L) / L;
	const top = -(shape.top - L) / L;
	const radiusAt = radiusAtY(outlinePoints(name));
	const eyeY = Math.min(top - 0.02, Math.max(bottom + 0.02, 0));
	return {
		kind: "wrap",
		wrapR: radiusAt(eyeY),
		wrapY0: bottom,
		wrapY1: top,
		eyeY,
		radiusAt,
		puffAt: puffs.length > 0 ? (x, y) => nearestPuff(puffs, x, y) : undefined,
	};
}

/** The ball whose surface is frontmost at (x, y), or the nearest one when none covers it. */
function nearestPuff(list: Ball[], x: number, y: number) {
	let best = list[0]!;
	let front = -Infinity;
	let gap = Infinity;
	let isCovered = false;
	for (const ball of list) {
		const distance = Math.hypot(x - ball[0], y - ball[1]);
		if (distance < ball[3]) {
			const z = ball[2] + Math.sqrt(ball[3] * ball[3] - distance * distance);
			if (!isCovered || z > front) {
				isCovered = true;
				front = z;
				best = ball;
			}
		} else if (!isCovered && distance - ball[3] < gap) {
			gap = distance - ball[3];
			best = ball;
		}
	}
	return { x: best[0], y: best[1], z: best[2], r: best[3] };
}

/** A rounded slab: the outline's rim swept through a quarter-round edge on both faces. */
function slabSamples(name: DrawnShape, depth: number, edge: number): Point3[] {
	const ring = outline(name).ring.map(([x, y]) => ({ x: (x - L) / L, y: -(y - L) / L }));
	const count = ring.length;
	const samples: Point3[] = [];
	for (let i = 0; i < count; i++) {
		const at = ring[i]!;
		const before = ring[(i - 1 + count) % count]!;
		const after = ring[(i + 1) % count]!;
		let nx = after.y - before.y;
		let ny = -(after.x - before.x);
		const length = Math.hypot(nx, ny) || 1;
		nx /= length;
		ny /= length;
		if (nx * at.x + ny * at.y < 0) {
			nx = -nx;
			ny = -ny;
		}
		for (let k = 0; k <= BEVEL_STEPS; k++) {
			const angle = (k / BEVEL_STEPS) * (Math.PI / 2);
			const inset = edge * (1 - Math.cos(angle));
			const z = depth - edge + edge * Math.sin(angle);
			samples.push({ x: at.x - nx * inset, y: at.y - ny * inset, z });
			samples.push({ x: at.x - nx * inset, y: at.y - ny * inset, z: -z });
		}
	}
	return samples;
}

/** A hexagonal crystal: two tips and two hexagonal rings, each point a small sphere. */
function crystalSamples(): Point3[] {
	const radius = 0.12;
	const corners: Point3[] = [
		{ x: 0, y: 1.04, z: 0 },
		{ x: 0, y: -1.04, z: 0 },
	];
	const reach = 0.52;
	for (const side of [-1, 1])
		for (let i = 0; i < 6; i++) {
			const angle = (i / 6) * TAU;
			corners.push({ x: reach * Math.cos(angle), y: side * 0.51, z: reach * Math.sin(angle) });
		}
	const samples: Point3[] = [];
	for (const corner of corners)
		for (let i = 0; i <= 8; i++) {
			const polar = (i / 8) * Math.PI;
			const sin = Math.sin(polar);
			const around = i === 0 || i === 8 ? 1 : 14;
			for (let j = 0; j < around; j++) {
				const azimuth = (j / around) * TAU;
				samples.push({
					x: corner.x + radius * sin * Math.sin(azimuth),
					y: corner.y + radius * Math.cos(polar),
					z: corner.z + radius * sin * Math.cos(azimuth),
				});
			}
		}
	return samples;
}

/** The outline's horizontal width at any y, found through a bucketed edge list. */
function widthAtY(points: Vec2[]): (y: number) => number {
	const count = points.length;
	let low = Infinity;
	let high = -Infinity;
	for (const [, y] of points) {
		if (y < low) low = y;
		if (y > high) high = y;
	}
	low -= WIDTH_PAD;
	high += WIDTH_PAD;
	const bucketOf = (y: number) => Math.min(63, Math.floor(((y - low) / (high - low)) * WIDTH_BUCKETS));
	const buckets: number[][] = Array.from({ length: WIDTH_BUCKETS }, () => []);
	for (let i = 0; i < count; i++) {
		const a = points[i]![1];
		const b = points[(i + 1) % count]![1];
		const last = bucketOf(Math.max(a, b) + WIDTH_PAD);
		for (let k = bucketOf(Math.min(a, b) - WIDTH_PAD); k <= last; k++) buckets[k]!.push(i);
	}
	return (y) => {
		let left = Infinity;
		let right = -Infinity;
		if (!(y >= low && y <= high)) return right - left;
		for (const i of buckets[bucketOf(y)]!) {
			const [ax, ay] = points[i]!;
			const [bx, by] = points[(i + 1) % count]!;
			if (Math.abs(by - ay) < 1e-9) {
				if (Math.abs(ay - y) < 1e-6) {
					left = Math.min(left, ax, bx);
					right = Math.max(right, ax, bx);
				}
			} else if ((ay <= y && by >= y) || (by <= y && ay >= y)) {
				const x = ax + ((bx - ax) * (y - ay)) / (by - ay);
				if (x < left) left = x;
				if (x > right) right = x;
			}
		}
		return right - left;
	};
}

/** Samples a body of revolution: rings of its half width down its height, closing the pinched ends. */
function revolveSamples(points: Vec2[]): Point3[] {
	let top = Infinity;
	let bottom = -Infinity;
	for (const [, y] of points) {
		if (y < top) top = y;
		if (y > bottom) bottom = y;
	}
	const samples: Point3[] = [];
	const topY = -(top - L) / L;
	const bottomY = -(bottom - L) / L;
	const width = widthAtY(points);
	const halfWidth = (y: number) => {
		const w = width(y);
		return w < 0 ? 0 : w / 2 / L;
	};
	const height = bottom - top;
	const pinch = (edge: number, sign: number) => {
		if (halfWidth(edge) >= 0.06) return null;
		const at = halfWidth(edge);
		let join = height * 0.02;
		for (let d = height / 512; d <= height * 0.05; d += height / 512)
			if (Math.abs(halfWidth(edge + sign * d) - at) > 1e-4) {
				join = d;
				break;
			}
		return { yEdge: edge, sign, dJoin: join, rJoin: halfWidth(edge + sign * join) };
	};
	const pinches = [pinch(top, 1), pinch(bottom, -1)].filter((p) => p !== null);
	const radiusAt = (y: number) => {
		let r = halfWidth(y);
		for (const p of pinches) {
			const d = (y - p.yEdge) * p.sign;
			if (d >= 0 && d < p.dJoin) r = Math.min(r, p.rJoin * Math.sqrt(d / p.dJoin));
		}
		return r;
	};
	const cap = (y: number, edge: number) => {
		const r = radiusAt(edge);
		if (r < 0.06) samples.push({ x: 0, y, z: 0 });
		else samples.push(...ringAt(y, r));
	};
	cap(topY, top);
	for (let i = 1; i < 95; i++) {
		const t = (1 - Math.cos((i / 95) * Math.PI)) / 2;
		const y = top + (bottom - top) * t;
		const r = radiusAt(y);
		const unitY = -(y - L) / L;
		if (r < 1e-4) samples.push({ x: 0, y: unitY, z: 0 });
		else samples.push(...ringAt(unitY, r));
	}
	cap(bottomY, bottom);
	return samples;
}

function ringAt(y: number, radius: number): Point3[] {
	const ring: Point3[] = [];
	for (let i = 0; i < RING_SEGMENTS; i++) {
		const angle = (i / RING_SEGMENTS) * TAU;
		ring.push({ x: radius * Math.sin(angle), y, z: radius * Math.cos(angle) });
	}
	return ring;
}

/** The body's radius at a unit height. */
function radiusAtY(points: Vec2[]): (y: number) => number {
	const width = widthAtY(points);
	let top = Infinity;
	let bottom = -Infinity;
	for (const [, y] of points) {
		if (y < top) top = y;
		if (y > bottom) bottom = y;
	}
	return (y) => {
		const boxY = Math.max(top, Math.min(bottom, L - y * L));
		return Math.max(0.02, width(boxY) / 2 / L);
	};
}

/** A row of equal balls along one axis: a pill. */
function pillBalls(name: DrawnShape, axis: "x" | "y"): Ball[] {
	const { x0, x1, y0, y1 } = boundsOfRing(name);
	const halfX = (x1 - x0) / 2 / L;
	const halfY = (y1 - y0) / 2 / L;
	const radius = axis === "x" ? halfY : halfX;
	const reach = Math.max(0, (axis === "x" ? halfX : halfY) - radius);
	const from = -reach;
	const list: Ball[] = [];
	for (let i = 0; i < PILL_BALLS; i++) {
		const at = from + (reach - from) * (i / 32);
		list.push(axis === "x" ? [at, 0, 0, radius] : [0, at, 0, radius]);
	}
	return list;
}

function ballExtent(list: Ball[]) {
	let hx = 0.55;
	let hz = 0.35;
	for (const [x, , z, r] of list) {
		hx = Math.max(hx, Math.abs(x) + r);
		hz = Math.max(hz, Math.abs(z) + r);
	}
	return { hx, hz };
}

/** Fills an outline with the largest non-nested inscribed balls on a grid. */
function inscribedBalls(name: DrawnShape): Ball[] {
	const points = outlinePoints(name);
	let x0 = Infinity;
	let x1 = -Infinity;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (const [x, y] of points) {
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
	}
	const inside = (x: number, y: number) => {
		let isInside = false;
		const count = points.length;
		for (let i = 0, j = count - 1; i < count; j = i++) {
			const [ax, ay] = points[i]!;
			const [bx, by] = points[j]!;
			if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) isInside = !isInside;
		}
		return isInside;
	};
	const cell = Math.max(x1 - x0, y1 - y0) / BALL_GRID;
	const candidates: { x: number; y: number; r: number }[] = [];
	for (let y = y0 + cell / 2; y < y1; y += cell)
		for (let x = x0 + cell / 2; x < x1; x += cell) {
			if (!inside(x, y)) continue;
			let nearest = Infinity;
			for (const [px, py] of points) nearest = Math.min(nearest, (px - x) ** 2 + (py - y) ** 2);
			const r = Math.sqrt(nearest);
			if (r > cell) candidates.push({ x, y, r });
		}
	candidates.sort((a, b) => b.r - a.r);
	const kept: { x: number; y: number; r: number }[] = [];
	for (const c of candidates)
		if (!kept.some((k) => Math.hypot(c.x - k.x, c.y - k.y) + c.r <= k.r + cell * 0.25)) kept.push(c);
	return kept.map((c) => [(c.x - L) / L, -(c.y - L) / L, 0, c.r / L]);
}

/** An extrusion's rings: the outline scaled in through a rounded bevel on the back and front. */
function bevelRings(ring: Point3[], depth: number, bevel: number): Point3[][] {
	let x0 = Infinity;
	let x1 = -Infinity;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (const p of ring) {
		x0 = Math.min(x0, p.x);
		x1 = Math.max(x1, p.x);
		y0 = Math.min(y0, p.y);
		y1 = Math.max(y1, p.y);
	}
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	const half = Math.max(1e-4, Math.min((x1 - x0) / 2, (y1 - y0) / 2));
	const step = (k: number, side: number) => {
		const angle = (k / BEVEL_STEPS) * (Math.PI / 2);
		const z = depth - bevel + bevel * Math.sin(angle);
		return { z: side < 0 ? -z : z, scale: 1 - (bevel / half) * (1 - Math.cos(angle)) };
	};
	const steps: { z: number; scale: number }[] = [];
	for (let k = BEVEL_STEPS; k >= 0; k--) steps.push(step(k, -1));
	for (let k = 0; k <= BEVEL_STEPS; k++) steps.push(step(k, 1));
	return steps.map(({ z, scale }) => ring.map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale, z })));
}

/** The six-petal flower: the outer edge of seven overlapping discs, found by bisection along each ray. */
function flowerRing(): Point3[] {
	const reach = 0.58;
	const discs = [{ x: 0, y: 0, r: 0.36 }];
	for (let i = 0; i < 6; i++) {
		const angle = -Math.PI / 2 + (i * TAU) / 6;
		discs.push({ x: reach * Math.cos(angle), y: reach * Math.sin(angle), r: 0.33 });
	}
	const ring: Point3[] = [];
	for (let i = 0; i < 240; i++) {
		const angle = (i / 240) * TAU;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		let low = 0;
		let high = 0.9099999999999999;
		for (let k = 0; k < 22; k++) {
			const mid = (low + high) / 2;
			const x = mid * cos;
			const y = mid * sin;
			if (discs.some((d) => (x - d.x) * (x - d.x) + (y - d.y) * (y - d.y) <= d.r * d.r)) low = mid;
			else high = mid;
		}
		ring.push({ x: low * cos, y: low * sin, z: 0 });
	}
	return ring;
}

interface Loft {
	rings: Point3[][];
	center: Point2;
	depth: number;
}

/** A pillowy loft: the outline shrunk toward its centre through a rounded profile front and back. */
function loftRings(ring: Point2[], depth: number): Loft {
	const stride = ring.length / LOFT_SAMPLES;
	const samples = stride > 1 ? Array.from({ length: LOFT_SAMPLES }, (_, i) => ring[Math.floor(i * stride)]!) : ring;
	let x0 = Infinity;
	let x1 = -Infinity;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (const p of samples) {
		x0 = Math.min(x0, p.x);
		x1 = Math.max(x1, p.x);
		y0 = Math.min(y0, p.y);
		y1 = Math.max(y1, p.y);
	}
	const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
	const rings: Point3[][] = [];
	for (let i = 0; i <= LOFT_RINGS; i++) {
		const angle = -Math.PI / 2 + (Math.PI * i) / LOFT_RINGS;
		const scale = Math.max(0, Math.cos(angle)) ** +LOFT_EXPONENT;
		const z = depth * Math.sin(angle);
		rings.push(
			samples.map((p) => ({ x: center.x + (p.x - center.x) * scale, y: center.y + (p.y - center.y) * scale, z })),
		);
	}
	return { rings, center, depth };
}

/** The loft's front surface height at (x, y). */
function loftSurface({ rings, center, depth }: Loft): (x: number, y: number) => number {
	const middle = rings[Math.floor(rings.length / 2)]!;
	const reach = new Float64Array(SURFACE_ANGLES);
	for (let i = 0; i < SURFACE_ANGLES; i++) {
		const angle = ((i + 0.5) / SURFACE_ANGLES) * Math.PI * 2;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		let far = 0;
		for (let k = 0; k < middle.length; k++) {
			const a = middle[k]!;
			const b = middle[(k + 1) % middle.length]!;
			const ex = b.x - a.x;
			const ey = b.y - a.y;
			const det = cos * ey - sin * ex;
			if (Math.abs(det) < 1e-9) continue;
			const ax = a.x - center.x;
			const ay = a.y - center.y;
			const t = (ax * ey - ay * ex) / det;
			const u = (ax * sin - ay * cos) / det;
			if (t > far && u >= 0 && u <= 1) far = t;
		}
		reach[i] = far;
	}
	const radial = (x: number, y: number) => {
		const dx = x - center.x;
		const dy = y - center.y;
		const distance = Math.hypot(dx, dy);
		if (distance < 1e-8) return 0;
		const slot = (((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * SURFACE_ANGLES;
		const i = Math.floor(slot) % SURFACE_ANGLES;
		const t = slot - Math.floor(slot);
		const a = reach[i]!;
		const b = reach[(i + 1) % SURFACE_ANGLES]!;
		return Math.min(1, distance / Math.max(1e-8, a * (1 - t) + b * t));
	};
	return (x, y) => depth * Math.sqrt(Math.max(0, 1 - radial(x, y) ** (2 / LOFT_EXPONENT)));
}

const BODY_MODELS: Record<ShapedBody, () => BodyModel> = {
	pebble: () => revolvedBody(1.2167999999999999, "pebble"),
	bean: () => {
		const list = inscribedBalls("bean");
		return { size: 1.17, silhouette: balls(list), seat: wrapSeat("bean", list) };
	},
	egg: () => revolvedBody(1.17, "egg"),
	squircle: () => ({
		size: 1.17,
		silhouette: solid(slabSamples("squircle", 0.28, 0.11)),
		seat: { kind: "front", faceZ: 0.28 },
	}),
	tablet: () => {
		const { x0, x1, y0, y1 } = boundsOfRing("tablet");
		const halfX = (x1 - x0) / 2 / L;
		const radius = (y1 - y0) / 2 / L;
		const straight = Math.max(0, halfX - radius);
		return {
			size: 1.3922999999999999,
			silhouette: balls(pillBalls("tablet", "x")),
			seat: {
				kind: "wrapX",
				wrapR: radius,
				wrapX0: -halfX + 0.02,
				wrapX1: halfX - 0.02,
				radiusAtX: (x) => {
					const past = Math.abs(x) - straight;
					return past <= 0 ? radius : Math.sqrt(Math.max(0, radius * radius - past * past));
				},
			},
		};
	},
	capsule: () => {
		const list = pillBalls("capsule", "y");
		const { y0, y1 } = boundsOfRing("capsule");
		const bottom = -(y1 - L) / L;
		const top = -(y0 - L) / L;
		const { hx, hz } = ballExtent(list);
		return {
			size: 1.17,
			silhouette: balls(list),
			seat: {
				kind: "wrap",
				wrapR: Math.max(0.35, (hx + hz) * 0.5),
				wrapY0: bottom,
				wrapY1: top,
				eyeY: (bottom + top) * 0.5,
			},
		};
	},
	cylinder: () => revolvedWithBelt("cylinder", (top, bottom) => (bottom + top) * 0.5),
	hex: () => extruded(1.2519, toUnit(outlinePoints("hex"))),
	gem: () => revolvedBody(1.17, "gem"),
	crystal: () => ({
		size: 1.3805999999999998,
		silhouette: solid(crystalSamples()),
		seat: { kind: "front", faceZ: (Math.sqrt(3) / 2) * 0.64 },
	}),
	wedge: () => {
		const shape = wedgeOutline(60, 80);
		const points = flatten(shape.path);
		const [left, right] = shape.spanAt(shape.top + (shape.bottom - shape.top) * 0.5);
		const top = -(shape.top - L) / L;
		const bottom = -(shape.bottom - L) / L;
		return {
			size: 1.3590719999999998,
			silhouette: revolved(revolveSamples(points)),
			seat: {
				kind: "wrap",
				wrapR: Math.max(0.2, (right - left) / 2 / L),
				wrapY0: bottom,
				wrapY1: top,
				eyeY: top + (bottom - top) * 0.5,
				radiusAt: radiusAtY(points),
			},
		};
	},
	shield: () => revolvedBody(1.17, "shield"),
	dome: () => revolvedBody(1.17, "dome"),
	arch: () => revolvedWithBelt("arch", (top, bottom) => top + (bottom - top) * 0.42),
	cloud: () => lofted(1.3455, toUnit(outlinePoints("cloud", 1)), 0.72),
	teardrop: () => {
		const shape = teardropOutline(88, 48);
		const points = flatten(shape.path);
		const [left, right] = shape.spanAt(shape.top + (shape.bottom - shape.top) * 0.62);
		const bottom = -(shape.bottom - L) / L;
		const top = -(shape.top - L) / L;
		return {
			size: 1.318122,
			silhouette: revolved(revolveSamples(points)),
			seat: {
				kind: "wrap",
				wrapR: Math.max(0.2, (right - left) / 2 / L),
				wrapY0: bottom,
				wrapY1: top,
				eyeY: (bottom + top) * 0.5,
				radiusAt: radiusAtY(points),
			},
		};
	},
	leaf: () => revolvedBody(1.17, "leaf"),
	square: () => extruded(1.0413, toUnit(outlinePoints("square"))),
	starFlower: () => extruded(1.3922999999999999, flowerRing()),
	sparkle: () => extruded(1.521, toUnit(outlinePoints("sparkle"))),
	clover: () => extruded(1.0881, toUnit(outlinePoints("clover"))),
	heartChubby: () => lofted(1.3571999999999997, HEART_RING as Point2[], 0.62),
	house: () => extruded(1.17, toUnit(outlinePoints("house"))),
	star6: () => extrusion(1.4976, toUnit(outlinePoints("star6")), 0.3, 0.18),
};

const models = new Map<ShapedBody, BodyModel>();

export function bodyModel(body: ShapedBody): BodyModel {
	const cached = models.get(body);
	if (cached != null) return cached;
	const built = BODY_MODELS[body]();
	models.set(body, built);
	return built;
}

// ─── Projection ─────────────────────────────────────────────────────────────

const MIN_SIZE = 0.2;
const SPHERE_SCALE = 0.36;
const SPHERE_FRAME = 1.18;
const HULL_DIRECTIONS = 160;
const LOFT_DIRECTIONS = 480;
const LOFT_MARGIN = 1.01;
const LOFT_SKIP = 1e-5;
const LOFT_SKIP_FLOOR = 0.01;
const HULL_BUCKET = 8;

const unitCircle = (count: number): Point2[] =>
	Array.from({ length: count }, (_, i) => {
		const angle = (i / count) * TAU;
		return { x: Math.cos(angle), y: Math.sin(angle) };
	});
const HULL_RAYS = unitCircle(HULL_DIRECTIONS);
const LOFT_RAYS = unitCircle(LOFT_DIRECTIONS);

/** The pixel radius of a body of model `size` drawn in a sprite of `sprite` pixels. */
export const bodyRadius = (model: BodyModel, sprite: number): number =>
	Math.max(MIN_SIZE, model.size) * ((SPHERE_SCALE * sprite) / SPHERE_FRAME);

export interface Rotation {
	yaw: number;
	pitch: number;
	roll: number;
}

interface Projector {
	rotate: (p: Point3) => Point3;
	project: (p: Point3) => Point2;
	origin: Point2;
	radius: number;
}

function cosSin(angle: number): [number, number, number] {
	const cos = Math.cos(angle);
	return [cos, Math.sin(angle), 1 - cos];
}

/** Yaw about Y, then pitch about X, then roll about Z. */
function rotator(yaw: number, pitch: number, roll: number): (p: Point3) => Point3 {
	const [yc, ys, yk] = cosSin(yaw);
	const [pc, ps, pk] = cosSin(pitch);
	const [rc, rs, rk] = cosSin(roll);
	return ({ x, y, z }) => {
		const ax = x * yc + z * ys;
		const ay = y * yc + y * yk;
		const az = z * yc - x * ys;
		const bx = ax * pc + ax * pk;
		const by = ay * pc - az * ps;
		const bz = az * pc + ay * ps;
		return { x: bx * rc - by * rs, y: by * rc + bx * rs, z: bz * rc + bz * rk };
	};
}

function projector(model: BodyModel, rotation: Rotation, sprite: number): Projector {
	const half = sprite / 2;
	const radius = bodyRadius(model, sprite);
	const rotate = rotator(
		(rotation.yaw * Math.PI) / 180,
		(rotation.pitch * Math.PI) / 180,
		(rotation.roll * Math.PI) / 180,
	);
	return {
		rotate,
		project: (p) => {
			const r = rotate(p);
			return { x: half + radius * r.x, y: half - radius * r.y };
		},
		origin: { x: half, y: half },
		radius,
	};
}

/** Packs finite points as a flat [x, y, ...] polygon, or nothing when too few remain. */
function packed(points: Point2[]): number[][] {
	const [first] = points;
	if (points.length < 2 || !Number.isFinite(first!.x) || !Number.isFinite(first!.y)) return [];
	const flat: number[] = [];
	for (const p of points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) flat.push(p.x, p.y);
	return flat.length >= 6 ? [flat] : [];
}

function silhouettePolygons(silhouette: Silhouette, projection: Projector): Point2[][] {
	if (silhouette.kind === "loft") return [loftOutline(silhouette.rings, projection)];
	if (silhouette.kind === "solid") return [solidOutline(silhouette, projection)];
	const rings = silhouette.rings.map((ring) => ring.map(projection.project));
	const back = rings[0]!;
	const front = rings[rings.length - 1]!;
	const faces: Point2[][] = [front, back];
	for (let i = 1; i < rings.length; i++) {
		const a = rings[i - 1]!;
		const b = rings[i]!;
		for (let k = 0; k < b.length; k++) {
			const next = (k + 1) % front.length;
			faces.push([a[k]!, a[next]!, b[next]!, b[k]!]);
		}
	}
	return faces;
}

function solidOutline(
	silhouette: Extract<Silhouette, { kind: "solid" }>,
	{ project, origin, radius }: Projector,
): Point2[] {
	const points: Point2[] = [];
	for (const sample of silhouette.samples) {
		const p = project(sample);
		if (Number.isFinite(p.x) && Number.isFinite(p.y)) points.push(p);
	}
	if (silhouette.isLoop) return points;
	if (silhouette.balls.length === 0) return convexHull(points);
	const discs = silhouette.balls
		.map(([x, y, z, r]) => ({ ...project({ x, y, z }), r: r * radius }))
		.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y) && d.r > 1e-6);
	let cx = origin.x;
	let cy = origin.y;
	if (discs.length > 0) {
		cx = 0;
		cy = 0;
		for (const d of discs) {
			cx += d.x;
			cy += d.y;
		}
		cx /= discs.length;
		cy /= discs.length;
	}
	for (const { x: rx, y: ry } of HULL_RAYS) {
		let reach = 0;
		for (const d of discs) {
			const dx = d.x - cx;
			const dy = d.y - cy;
			const along = rx * dx + ry * dy;
			const disc = along * along - (dx * dx + dy * dy) + d.r * d.r;
			if (disc <= 0) continue;
			const hit = along + Math.sqrt(disc);
			if (hit > reach) reach = hit;
		}
		if (reach > 0) points.push({ x: cx + rx * reach, y: cy + ry * reach });
	}
	if (silhouette.samples.length > 0) return convexHull(points);
	if (points.length >= 3) return points;
	for (const d of discs)
		for (let i = 0; i < 48; i++) {
			const angle = (i / 48) * TAU;
			points.push({ x: d.x + d.r * Math.cos(angle), y: d.y + d.r * Math.sin(angle) });
		}
	return points.length >= 3 ? convexHull(points) : points;
}

/** Andrew's monotone-chain hull. */
function convexHull(input: Point2[]): Point2[] {
	const sorted = sortByX(input.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
	if (sorted.length < 3) return sorted;
	const cross = (o: Point2, a: Point2, b: Point2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower: Point2[] = [];
	for (const p of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
		lower.push(p);
	}
	const upper: Point2[] = [];
	for (let i = sorted.length - 1; i >= 0; i--) {
		const p = sorted[i]!;
		while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return [...lower, ...upper];
}

/** Sorts points by x then y: bucketed, then insertion sort within each bucket. */
function sortByX(points: Point2[]): Point2[] {
	let low = Infinity;
	let high = -Infinity;
	for (const { x } of points) {
		if (x < low) low = x;
		if (x > high) high = x;
	}
	const count = Math.ceil(points.length / HULL_BUCKET);
	const scale = high > low ? count / (high - low) : 0;
	const bucketOf = (x: number) => Math.min(count - 1, Math.floor((x - low) * scale));
	const starts = new Int32Array(count + 1);
	for (const { x } of points) {
		const b = bucketOf(x) + 1;
		starts[b] = starts[b]! + 1;
	}
	for (let i = 0; i < count; i++) starts[i + 1] = starts[i + 1]! + starts[i]!;
	const fill = starts.slice(0, count);
	const sorted: Point2[] = Array(points.length);
	for (const p of points) {
		const b = bucketOf(p.x);
		sorted[fill[b]!] = p;
		fill[b] = fill[b]! + 1;
	}
	for (let b = 0; b < count; b++)
		for (let i = starts[b]! + 1; i < starts[b + 1]!; i++) {
			const p = sorted[i]!;
			let j = i - 1;
			while (j >= starts[b]! && (sorted[j]!.x > p.x || (sorted[j]!.x === p.x && sorted[j]!.y > p.y))) {
				sorted[j + 1] = sorted[j]!;
				j--;
			}
			sorted[j + 1] = p;
		}
	return sorted;
}

/** A loft's silhouette: the farthest edge crossing along 480 rays from the centre. */
function loftOutline(rings3: Point3[][], { project, origin }: Projector): Point2[] {
	const rings = rings3.map((ring) => ring.map(project));
	const centroid = (ring: Point2[]) => {
		let x = 0;
		let y = 0;
		for (const p of ring) {
			x += p.x;
			y += p.y;
		}
		return { x: x / ring.length, y: y / ring.length };
	};
	const back = centroid(rings[0]!);
	const front = centroid(rings[rings.length - 1]!);
	if (Math.hypot(front.x - back.x, front.y - back.y) < 1e-4) {
		let widest = rings[0]!;
		let widestArea = 0;
		for (const ring of rings) {
			let area = 0;
			for (let i = 0; i < ring.length; i++) {
				const a = ring[i]!;
				const b = ring[(i + 1) % ring.length]!;
				area += a.x * b.y - b.x * a.y;
			}
			if (Math.abs(area) > widestArea) {
				widest = ring;
				widestArea = Math.abs(area);
			}
		}
		return widest;
	}
	const reachSq = rings.map((ring) =>
		ring.map(({ x, y }) => (x - origin.x) * (x - origin.x) + (y - origin.y) * (y - origin.y)),
	);
	const farthest = reachSq.map((list) => Math.max(...list));
	const skipMargin = LOFT_SKIP * Math.max(...farthest) + LOFT_SKIP_FLOOR;
	const isHidden = (distanceSq: number, floor: number) => {
		const inner = (floor - skipMargin) / LOFT_MARGIN;
		return inner > 0 && distanceSq < inner * inner;
	};
	const slots = rings.map((ring) =>
		ring.map((p) => {
			const angle = (Math.atan2(p.y - origin.y, p.x - origin.x) + TAU) % TAU;
			return Math.floor((angle / TAU) * LOFT_DIRECTIONS) % LOFT_DIRECTIONS;
		}),
	);
	const reach = new Float64Array(LOFT_DIRECTIONS);
	let floor = 0;
	const cast = (a: Point2, b: Point2, slotA: number, slotB: number, distanceSq: number) => {
		if (isHidden(distanceSq, floor)) return;
		let span = slotB - slotA;
		if (span > LOFT_DIRECTIONS / 2) span -= LOFT_DIRECTIONS;
		else if (span < -240) span += LOFT_DIRECTIONS;
		const direction = span < 0 ? -1 : 1;
		const steps = Math.abs(span);
		let lowest = Infinity;
		for (let k = -1; k <= steps + 1; k++) {
			const slot = (slotA + direction * k + LOFT_DIRECTIONS) % LOFT_DIRECTIONS;
			if (reach[slot]! < lowest) lowest = reach[slot]!;
		}
		if (isHidden(distanceSq, lowest)) return;
		const ex = b.x - a.x;
		const ey = b.y - a.y;
		const ax = a.x - origin.x;
		const ay = a.y - origin.y;
		for (let k = -1; k <= steps + 1; k++) {
			const slot = (slotA + direction * k + LOFT_DIRECTIONS) % LOFT_DIRECTIONS;
			const { x: rx, y: ry } = LOFT_RAYS[slot]!;
			const det = rx * ey - ry * ex;
			if (Math.abs(det) < 1e-9) continue;
			const t = (ax * ey - ay * ex) / det;
			const u = (ax * ry - ay * rx) / det;
			if (t > reach[slot]! && u >= 0 && u <= 1) reach[slot] = t;
		}
	};
	const order = farthest.map((_, i) => i).sort((a, b) => farthest[b]! - farthest[a]!);
	for (const r of order) {
		const ring = rings[r]!;
		for (let i = 0; i < ring.length; i++) {
			const j = (i + 1) % ring.length;
			cast(ring[i]!, ring[j]!, slots[r]![i]!, slots[r]![j]!, Math.max(reachSq[r]![i]!, reachSq[r]![j]!));
		}
		floor = Math.min(...reach);
	}
	for (let r = 0; r < rings.length - 1; r++) {
		const a = rings[r]!;
		const b = rings[r + 1]!;
		for (let i = 0; i < Math.min(a.length, b.length); i++)
			cast(a[i]!, b[i]!, slots[r]![i]!, slots[r + 1]![i]!, Math.max(reachSq[r]![i]!, reachSq[r + 1]![i]!));
	}
	return LOFT_RAYS.flatMap(({ x, y }, i) =>
		reach[i]! > 0 ? [{ x: origin.x + x * reach[i]!, y: origin.y + y * reach[i]! }] : [],
	);
}

/** The projected silhouette polygons of a body, as flat [x, y, ...] arrays. */
export function silhouette(model: BodyModel, rotation: Rotation, sprite: number): number[][] {
	const s = model.silhouette;
	if (s.kind !== "extrusion" || !s.isConvex)
		return silhouettePolygons(s, projector(model, rotation, sprite)).flatMap(packed);
	const { project } = projector(model, rotation, sprite);
	return packed(convexHull(s.rings.flat().map(project)));
}

// ─── Eyes on the surface ────────────────────────────────────────────────────

export interface EyeLoops {
	loops: Point2[][];
	shiftY: number;
}

/** The eye outlines placed on the body's seat and projected, as flat [x, y, ...] arrays. */
export function seatedEyes(model: BodyModel, rotation: Rotation, sprite: number, eyes: EyeLoops): number[][] {
	return model.seat == null ? [] : seatLoops(model.seat, eyes, projector(model, rotation, sprite)).flatMap(packed);
}

function seatLoops(seat: Seat, eyes: EyeLoops, projection: Projector): Point2[][] {
	switch (seat.kind) {
		case "front":
			return onFront(seat.faceZ, eyes, projection);
		case "loft":
			return onLoft(seat.surfaceZ, eyes, projection);
		case "wrap":
			return aroundY(seat, eyes, projection);
		case "wrapX":
			return aroundX(seat, eyes, projection);
	}
}

function onFront(faceZ: number, { loops, shiftY }: EyeLoops, projection: Projector): Point2[][] {
	if (!(projection.rotate({ x: 0, y: 0, z: 1 }).z > 0.03)) return [];
	const shift = Math.sin(shiftY);
	return loops
		.filter((loop) => loop.length >= 3)
		.map((loop) => loop.map((p) => projection.project({ x: p.x, y: p.y - shift, z: faceZ })));
}

function onLoft(
	surfaceZ: (x: number, y: number) => number,
	{ loops, shiftY }: EyeLoops,
	{ rotate, project }: Projector,
): Point2[][] {
	if (!(rotate({ x: 0, y: 0, z: 1 }).z >= 0.05)) return [];
	const shift = Math.sin(shiftY);
	const result: Point2[][] = [];
	for (const loop of loops) {
		if (loop.length < 3) continue;
		const moved = loop.map((p) => ({ x: p.x, y: p.y - shift }));
		let cx = 0;
		let cy = 0;
		for (const p of moved) {
			cx += p.x;
			cy += p.y;
		}
		cx /= moved.length;
		cy /= moved.length;
		const h = 4e-3;
		const slopeX = (surfaceZ(cx + h, cy) - surfaceZ(cx - h, cy)) / (2 * h);
		const slopeY = (surfaceZ(cx, cy + h) - surfaceZ(cx, cy - h)) / (2 * h);
		const length = Math.hypot(slopeX, slopeY, 1);
		if (rotate({ x: -slopeX / length, y: -slopeY / length, z: 1 / length }).z < 0.12) continue;
		const z = surfaceZ(cx, cy);
		result.push(moved.map((p) => project({ x: p.x, y: p.y, z: z + (p.x - cx) * slopeX + (p.y - cy) * slopeY })));
	}
	return result;
}

function aroundY(seat: WrapSeat, { loops, shiftY }: EyeLoops, { rotate, project }: Projector): Point2[][] {
	const { wrapR, wrapY0, wrapY1, radiusAt, puffAt } = seat;
	const margin = radiusAt ? 0.02 : 0.06;
	const eyeY = Math.min(wrapY1 - margin, Math.max(wrapY0 + margin, seat.eyeY - shiftY));
	const clampY = (y: number) => Math.min(wrapY1, Math.max(wrapY0, y));
	const wrapLoop = (loop: Point2[]) => {
		const points: Point2[] = [];
		for (const p of loop) {
			const y = clampY(eyeY + p.y);
			const radius = radiusAt ? radiusAt(y) : wrapR;
			const angle = Math.max(-2.6, Math.min(2.6, p.x / Math.max(0.12, radius)));
			let slope = 0;
			if (radiusAt) {
				const h = 0.012;
				slope = -(radiusAt(Math.min(wrapY1, y + h)) - radiusAt(Math.max(wrapY0, y - h))) / (2 * h);
			}
			if (rotate({ x: Math.sin(angle), y: slope, z: Math.cos(angle) }).z >= 0.05)
				points.push(project({ x: radius * Math.sin(angle), y, z: radius * Math.cos(angle) }));
		}
		return points;
	};
	const puffLoop = (loop: Point2[]) => {
		if (!puffAt || loop.length === 0) return [];
		let sx = 0;
		let sy = 0;
		for (const p of loop) {
			sx += p.x;
			sy += p.y;
		}
		const puff = puffAt(sx / loop.length, clampY(eyeY + sy / loop.length));
		const facing = rotate({ x: 0, y: 0, z: 1 }).z;
		const points: Point2[] = [];
		for (const p of loop) {
			const dx = p.x - puff.x;
			const dy = clampY(eyeY + p.y) - puff.y;
			const distance = Math.hypot(dx, dy);
			let polar = Math.min(distance / puff.r, Math.PI - 0.02);
			const ux = distance > 1e-9 ? dx / distance : 1;
			const uy = distance > 1e-9 ? dy / distance : 0;
			const side = rotate({ x: ux, y: uy, z: 0 }).z;
			const towardViewer = (a: number) => side * Math.sin(a) + facing * Math.cos(a);
			if (towardViewer(polar) < 0.06 && facing > 0.06) {
				let low = 0;
				let high = polar;
				for (let k = 0; k < 20; k++) {
					const mid = (low + high) / 2;
					if (towardViewer(mid) >= 0.06) low = mid;
					else high = mid;
				}
				polar = low;
			}
			const out = puff.r * Math.sin(polar);
			if (rotate({ x: ux * Math.sin(polar), y: uy * Math.sin(polar), z: Math.cos(polar) }).z >= 0.05)
				points.push(project({ x: puff.x + ux * out, y: puff.y + uy * out, z: puff.z + puff.r * Math.cos(polar) }));
		}
		return points;
	};
	let low = Infinity;
	let high = -Infinity;
	for (const loop of loops)
		for (const p of loop) {
			if (p.y < low) low = p.y;
			if (p.y > high) high = p.y;
		}
	let nudge = 0;
	if (high - low <= wrapY1 - wrapY0) {
		if (eyeY + low < wrapY0) nudge = wrapY0 - (eyeY + low);
		else if (eyeY + high > wrapY1) nudge = wrapY1 - (eyeY + high);
	}
	const placed = nudge === 0 ? loops : loops.map((loop) => loop.map((p) => ({ x: p.x, y: p.y + nudge })));
	return placed.map(puffAt ? puffLoop : wrapLoop).filter((loop) => loop.length > 2);
}

function aroundX(
	seat: Extract<Seat, { kind: "wrapX" }>,
	{ loops, shiftY }: EyeLoops,
	{ rotate, project }: Projector,
): Point2[][] {
	const { wrapR, wrapX0, wrapX1, radiusAtX } = seat;
	const lift = Math.max(-2.4, Math.min(2.4, -shiftY / wrapR));
	let low = Infinity;
	let high = -Infinity;
	for (const loop of loops)
		for (const p of loop) {
			if (p.x < low) low = p.x;
			if (p.x > high) high = p.x;
		}
	let nudge = 0;
	if (high - low <= wrapX1 - wrapX0) {
		if (low < wrapX0) nudge = wrapX0 - low;
		else if (high > wrapX1) nudge = wrapX1 - high;
	}
	return (nudge === 0 ? loops : loops.map((loop) => loop.map((p) => ({ x: p.x + nudge, y: p.y }))))
		.map((loop) => {
			const points: Point2[] = [];
			for (const p of loop) {
				const x = Math.min(wrapX1, Math.max(wrapX0, p.x));
				const radius = radiusAtX(x);
				const angle = lift + Math.max(-2.6, Math.min(2.6, p.y / Math.max(0.12, wrapR)));
				const h = 0.012;
				if (
					rotate({
						x: -(radiusAtX(Math.min(wrapX1, x + h)) - radiusAtX(Math.max(wrapX0, x - h))) / (2 * h),
						y: Math.sin(angle),
						z: Math.cos(angle),
					}).z >= 0.05
				)
					points.push(project({ x, y: radius * Math.sin(angle), z: radius * Math.cos(angle) }));
			}
			return points;
		})
		.filter((loop) => loop.length > 2);
}

// ─── Eye outlines for shapes ────────────────────────────────────────────────
// Shapes draw the face's eyes flat, sized and spaced per shape, then the seat wraps them onto the body.

const EYE_W = 0.26;
const EYE_H = 0.57;
const EYE_GAP = 0.64;
const BEZIER_STEPS = 11;
const PATH_LENGTH = 18;
const OVAL_POINTS = 48;
const CAP_POINTS = 10;
const LOOP_POINTS = 64;

interface EyeMetrics {
	width: number;
	height: number;
	gap: number;
	shiftY: number;
}

const EYE_METRICS: Record<ShapedBody, EyeMetrics> = {
	cloud: { width: 0.21294, height: 0.4668299999999999, gap: 0.47001600000000004, shiftY: 0.06999999999999999 },
	square: { width: 0.2553258426966292, height: 0.559752808988764, gap: 0.529408, shiftY: 0.12 },
	sparkle: { width: 0.18381999999999998, height: 0.40298999999999996, gap: 0.41215999999999997, shiftY: 0 },
	clover: { width: 0.23296, height: 0.51072, gap: 0.559104, shiftY: -0.020000000000000018 },
	heartChubby: { width: 0.18657600000000002, height: 0.409032, gap: 0.44620799999999994, shiftY: 0.051999999999999935 },
	starFlower: { width: 0.19292, height: 0.42294, gap: 0.38297600000000004, shiftY: 0.12 },
	teardrop: { width: 0.20779200000000003, height: 0.455544, gap: 0.45260800000000007, shiftY: 0.18 },
	tablet: { width: 0.2132, height: 0.4673999999999999, gap: 0.587776, shiftY: 0.01999999999999999 },
	wedge: { width: 0.2132, height: 0.4673999999999999, gap: 0.46771199999999996, shiftY: 0.18 },
	house: { width: 0.2295124, height: 0.5031617999999999, gap: 0.5125120000000001, shiftY: 0.18499534000463813 },
	star6: { width: 0.184782, height: 0.44965988999999995, gap: 0.41913343999999997, shiftY: 0.12 },
	pebble: { width: 0.23920000000000002, height: 0.5244, gap: 0.546304, shiftY: 0.12 },
	bean: { width: 0.2028, height: 0.4446, gap: 0.4608, shiftY: 0.12 },
	egg: { width: 0.23920000000000002, height: 0.5244, gap: 0.433664, shiftY: 0.11299906800092761 },
	squircle: { width: 0.23920000000000002, height: 0.5244, gap: 0.5632, shiftY: 0.12 },
	capsule: { width: 0.2106, height: 0.4617, gap: 0.36044800000000005, shiftY: 0.12 },
	cylinder: { width: 0.23920000000000002, height: 0.5244, gap: 0.47872000000000003, shiftY: 0.12 },
	hex: { width: 0.26, height: 0.57, gap: 0.64, shiftY: 0.12 },
	gem: { width: 0.23920000000000002, height: 0.5244, gap: 0.501248, shiftY: 0.12 },
	crystal: { width: 0.1612, height: 0.3534, gap: 0.3712, shiftY: 0.12 },
	shield: { width: 0.26790400000000003, height: 0.5873280000000001, gap: 0.44492800000000005, shiftY: 0.12 },
	dome: { width: 0.2132, height: 0.4673999999999999, gap: 0.47872000000000003, shiftY: 0.10599813600185524 },
	arch: { width: 0.19240000000000002, height: 0.42179999999999995, gap: 0.44799999999999995, shiftY: 0.16 },
	leaf: { width: 0.1872, height: 0.41039999999999993, gap: 0.44799999999999995, shiftY: 0.039999999999999994 },
};

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);
const isOvalEye = (eye: Eye): boolean => eye.oval[0] > 1e-4 && eye.oval[1] > 1e-4;

/** The face's eyes as flat outlines sized for `body`. */
export function eyeLoops(body: ShapedBody, eyes: readonly [Eye, Eye]): EyeLoops {
	const m = EYE_METRICS[body];
	const scale = m.width / EYE_W;
	const heightScale = m.height / EYE_H;
	const gapScale = m.gap / EYE_GAP;
	return eyes.every((eye) => isOvalEye(eye) && !(eye.fillRing != null && eye.fillRing.length > 0))
		? ovalLoops(eyeBox(eyes[0]), eyeBox(eyes[1]), m, scale, heightScale, gapScale)
		: { loops: strokeLoops(eyes, scale, gapScale, heightScale, 0, m.shiftY), shiftY: 0 };
}

interface Box {
	on: boolean;
	oval: boolean;
	width: number;
	height: number;
	tilt: number;
	cx: number;
	cy: number;
}

const NO_BOX: Box = { on: false, oval: false, width: 0, height: 0, tilt: 0, cx: 0, cy: 0 };

function eyeBox(eye: Eye): Box {
	const oval = isOvalEye(eye);
	if (!(eye.wid > 0) && !oval) return NO_BOX;
	const lid = eye.lidY || 1;
	const tilt = (eye.tilt || 0) * (180 / Math.PI);
	if (oval)
		return {
			on: true,
			oval: true,
			width: 2 * eye.oval[0],
			height: 2 * eye.oval[1] * lid,
			tilt,
			cx: eye.off[0],
			cy: eye.off[1],
		};
	const pts = eye.pts;
	if (pts.length < 2) return { ...NO_BOX, cx: eye.off[0], cy: eye.off[1] };
	const first = pts[0]!;
	const last = pts[pts.length - 1]!;
	const dx = last[0] - first[0];
	const dy = last[1] - first[1];
	const length = Math.hypot(dx, dy);
	const width = 2 * eye.wid;
	return {
		on: true,
		oval: false,
		width,
		height: (length + width) * lid,
		tilt: (180 / Math.PI) * Math.atan2(dx, dy) + tilt,
		cx: eye.off[0] + (first[0] + last[0]) / 2,
		cy: eye.off[1] + ((first[1] + last[1]) / 2) * lid,
	};
}

function ovalLoops(
	left: Box,
	right: Box,
	m: EyeMetrics,
	scale: number,
	heightScale: number,
	gapScale: number,
): EyeLoops {
	const lw = finite(left.width * scale);
	const lh = finite(left.height * scale);
	const rw = finite(right.width * scale);
	const rh = finite(right.height * scale);
	const lMinor = Math.max(0, finite(Math.min(lw, lh)));
	const lMajor = Math.max(0, finite(Math.max(lw, lh)));
	const rMinor = Math.max(0, finite(Math.min(rw, rh)));
	const rMajor = Math.max(0, finite(Math.max(rw, rh)));
	const gap = Math.max(
		0,
		finite(
			(EYE_GAP + (left.on ? finite(left.cx) : 0) + (right.on ? finite(right.cx) : 0)) * gapScale,
			EYE_GAP * gapScale,
		),
	);
	const spacing = Math.max(0.05, Math.min(1.8, gap));
	return {
		loops: [
			ellipseLoop(-1, lMinor, lMajor, -finite(finite(left.tilt) + (lw >= lh ? 0 : 90)), spacing),
			ellipseLoop(1, rMinor, rMajor, finite(finite(right.tilt) + (rw >= rh ? 0 : 90)), spacing),
		],
		shiftY: finite(m.shiftY + ((finite(left.cy) + finite(right.cy)) / 2) * heightScale, m.shiftY),
	};
}

function ellipseLoop(side: number, minor: number, major: number, angle: number, gap: number): Point2[] {
	const ry = Math.max(0.01, Math.min(1, minor)) / 2;
	const rx = Math.max(0.02, Math.min(1.8, Math.max(major, minor))) / 2;
	const radians = (-angle * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return Array.from({ length: LOOP_POINTS }, (_, i) => {
		const t = (2 * Math.PI * i) / LOOP_POINTS;
		const x = side * rx * Math.cos(t);
		const y = ry * Math.sin(t);
		return { x: x * cos - y * sin + (side * gap) / 2, y: x * sin + y * cos };
	});
}

function strokeLoops(
	eyes: readonly Eye[],
	scale: number,
	gapScale: number,
	heightScale: number,
	lean: number,
	shiftY: number,
): Point2[][] {
	const loops: Point2[][] = [];
	const leanX = Math.sin(lean);
	const drop = -Math.sin(shiftY);
	eyes.forEach((eye, index) => {
		const oval = isOvalEye(eye);
		if ((!(eye.wid > 0) && !oval) || (!oval && eye.pts.length < 2)) return;
		const side = index === 0 ? -1 : 1;
		const lid = eye.lidY || 1;
		const cos = Math.cos(eye.tilt || 0);
		const sin = Math.sin(eye.tilt || 0);
		const ox = side * ((EYE_GAP / 2 + finite(eye.off[0])) * gapScale) + leanX;
		const oy = drop + finite(eye.off[1]) * heightScale;
		const place = (x: number, y: number): Point2 => {
			const rx = x * cos - y * sin;
			const ry = x * sin + y * cos;
			return { x: ox + side * rx * scale, y: oy + ry * scale * lid };
		};
		if (eye.fillRing != null && eye.fillRing.length >= 3) {
			const fx = finite(eye.off[0]);
			const fy = finite(eye.off[1]);
			loops.push(eye.fillRing.map(([x, y]) => place(x - fx, (y - fy) * lid)));
			return;
		}
		if (oval) {
			const ring: Point2[] = [];
			for (let i = 0; i < OVAL_POINTS; i++) {
				const t = (2 * Math.PI * i) / OVAL_POINTS;
				ring.push(place(eye.oval[0] * Math.cos(t), eye.oval[1] * lid * Math.sin(t)));
			}
			loops.push(ring);
			return;
		}
		const halfWidth = eye.wid * scale;
		const shape =
			eye.path != null && eye.path.length === PATH_LENGTH
				? thickBezier(eye.path, place, halfWidth)
				: thickPolyline(
						eye.pts.map((p) => place(p[0], p[1])),
						halfWidth,
					);
		if (shape.length > 0) loops.push(shape);
	});
	return loops;
}

/** The outline of a round-capped stroke along a polyline. */
function thickPolyline(input: Point2[], halfWidth: number): Point2[] {
	const points: Point2[] = [];
	for (const p of input) {
		const last = points.at(-1);
		if (last == null || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) points.push(p);
	}
	if (points.length === 0 || halfWidth <= 0) return [];
	const blob = fatBlob(points, halfWidth);
	if (blob != null) return blob;
	const count = points.length;
	if (count < 2) return [];
	const nx: number[] = [];
	const ny: number[] = [];
	for (let i = 0; i < count; i++) {
		const a = points[Math.max(0, i - 1)]!;
		const b = points[Math.min(count - 1, i + 1)]!;
		const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
		let x = -(b.y - a.y) / length;
		let y = (b.x - a.x) / length;
		if (i > 0 && x * nx[i - 1]! + y * ny[i - 1]! < 0) {
			x = -x;
			y = -y;
		}
		nx.push(x);
		ny.push(y);
	}
	return capStroke(
		points,
		nx,
		ny,
		halfWidth,
		unit(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y),
		unit(points[count - 1]!.x - points[count - 2]!.x, points[count - 1]!.y - points[count - 2]!.y),
	);
}

/** The outline of a round-capped stroke along an eye's two cubic segments. */
function thickBezier(path: number[], place: (x: number, y: number) => Point2, halfWidth: number): Point2[] {
	if (halfWidth <= 0) return [];
	const samples: (Point2 & { tx: number; ty: number })[] = [];
	for (let segment = 0; segment < 2; segment++) {
		const p0 = node(path, segment);
		const p1 = handle(path, segment, 4);
		const p2 = handle(path, segment + 1, 2);
		const p3 = node(path, segment + 1);
		for (let i = segment === 0 ? 0 : 1; i < BEZIER_STEPS; i++) {
			const t = i / 10;
			const at = bezier(p0, p1, p2, p3, t);
			const slope = bezierSlope(p0, p1, p2, p3, t);
			const a = place(at[0], at[1]);
			const b = place(at[0] + slope[0], at[1] + slope[1]);
			samples.push({ x: a.x, y: a.y, tx: b.x - a.x, ty: b.y - a.y });
		}
	}
	const blob = fatBlob(samples, halfWidth);
	if (blob != null) return blob;
	const count = samples.length;
	const nx: number[] = [];
	const ny: number[] = [];
	for (let i = 0; i < count; i++) {
		const length = Math.hypot(samples[i]!.tx, samples[i]!.ty) || 1;
		let x = -samples[i]!.ty / length;
		let y = samples[i]!.tx / length;
		if (i > 0 && x * nx[i - 1]! + y * ny[i - 1]! < 0) {
			x = -x;
			y = -y;
		}
		nx.push(x);
		ny.push(y);
	}
	const first = samples[0]!;
	const last = samples[count - 1]!;
	const firstLength = Math.hypot(first.tx, first.ty) || 1;
	const lastLength = Math.hypot(last.tx, last.ty) || 1;
	return capStroke(
		samples,
		nx,
		ny,
		halfWidth,
		{ x: first.tx / firstLength, y: first.ty / firstLength },
		{ x: last.tx / lastLength, y: last.ty / lastLength },
	);
}

function capStroke(
	points: Point2[],
	nx: number[],
	ny: number[],
	halfWidth: number,
	startDir: Point2,
	endDir: Point2,
): Point2[] {
	const count = points.length;
	const left = points.map((p, i) => ({ x: p.x + nx[i]! * halfWidth, y: p.y + ny[i]! * halfWidth }));
	const right = points.map((p, i) => ({ x: p.x - nx[i]! * halfWidth, y: p.y - ny[i]! * halfWidth }));
	const startTip = { x: points[0]!.x - startDir.x * halfWidth, y: points[0]!.y - startDir.y * halfWidth };
	const endTip = { x: points[count - 1]!.x + endDir.x * halfWidth, y: points[count - 1]!.y + endDir.y * halfWidth };
	return [
		...left,
		...roundCap(points[count - 1]!, left[count - 1]!, endTip, halfWidth),
		...[...right].reverse(),
		...roundCap(points[0]!, right[0]!, startTip, halfWidth),
	];
}

/** The half circle from `from` round through `toward`, about `centre`. */
function roundCap(centre: Point2, from: Point2, toward: Point2, radius: number): Point2[] {
	const points: Point2[] = [];
	const start = Math.atan2(from.y - centre.y, from.x - centre.x);
	let turn = Math.atan2(toward.y - centre.y, toward.x - centre.x) - start;
	while (turn > Math.PI) turn -= 2 * Math.PI;
	while (turn < -Math.PI) turn += 2 * Math.PI;
	const direction = turn >= 0 ? 1 : -1;
	for (let i = 1; i < CAP_POINTS; i++) {
		const angle = start + (i / CAP_POINTS) * direction * Math.PI;
		points.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) });
	}
	return points;
}

/** When the stroke is wider than its spine is long, its outline is just the spine grown by the width. */
function fatBlob(points: Point2[], halfWidth: number): Point2[] | null {
	let cx = 0;
	let cy = 0;
	for (const p of points) {
		cx += p.x;
		cy += p.y;
	}
	cx /= points.length;
	cy /= points.length;
	let spread = 0;
	for (const p of points) spread = Math.max(spread, Math.hypot(p.x - cx, p.y - cy));
	if (halfWidth <= spread * 1.05) return null;
	const outline: Point2[] = [];
	for (let i = 0; i < OVAL_POINTS; i++) {
		const angle = (2 * Math.PI * i) / OVAL_POINTS;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		let best = -1 / 0;
		let bx = 0;
		let by = 0;
		for (const p of points) {
			const along = p.x * cos + p.y * sin;
			if (along > best) {
				best = along;
				bx = p.x;
				by = p.y;
			}
		}
		outline.push({ x: bx + cos * halfWidth, y: by + sin * halfWidth });
	}
	return outline;
}

const node = (path: number[], i: number): Vec2 => [path[i * 6]!, path[i * 6 + 1]!];
const handle = (path: number[], i: number, offset: number): Vec2 => [
	path[i * 6]! + path[i * 6 + offset]!,
	path[i * 6 + 1]! + path[i * 6 + offset + 1]!,
];

function bezier(a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 {
	const u = 1 - t;
	return [
		u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
		u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
	];
}

function bezierSlope(a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 {
	const u = 1 - t;
	return [
		3 * u * u * (b[0] - a[0]) + 6 * u * t * (c[0] - b[0]) + 3 * t * t * (d[0] - c[0]),
		3 * u * u * (b[1] - a[1]) + 6 * u * t * (c[1] - b[1]) + 3 * t * t * (d[1] - c[1]),
	];
}

function unit(x: number, y: number): Point2 {
	const length = Math.hypot(x, y) || 1;
	return { x: x / length, y: y / length };
}
