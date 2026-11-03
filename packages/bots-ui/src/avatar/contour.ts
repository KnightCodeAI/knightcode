// Traces the zero contour of a signed distance field: marching squares, refined against the field, then simplified.

type Field = (x: number, y: number) => number;
type Point = [number, number];

export interface Grid {
	x0: number;
	y0: number;
	step: number;
	nx: number;
	ny: number;
}

export interface Tolerance {
	/** The furthest the outline may stray from the true contour. */
	deviation: number;
	/** The longest edge kept without a check. */
	edge: number;
}

const ROOT_ITERATIONS = 60;
const MARCH_STEPS = 256;
const MAX_DEPTH = 24;
const MAX_POINTS = 2e4;
const MIN_ALIGNMENT = 0.2;

interface Context {
	field: Field;
	tolerance: Tolerance;
	root: number;
	reach: number;
}

/** The closed loops where `field` crosses zero, negative inside. */
export function contours(field: Field, grid: Grid, tolerance: Tolerance): Point[][] {
	const context: Context = {
		field,
		tolerance,
		root: tolerance.deviation * 1e-3,
		reach: grid.step * Math.hypot(grid.nx, grid.ny),
	};
	const loops: Point[][] = [];
	for (const loop of march(context, grid)) {
		const simple = simplify(refine(context, loop), tolerance);
		if (simple.length >= 3) loops.push(simple);
	}
	return loops;
}

function march(context: Context, grid: Grid): Point[][] {
	const { field } = context;
	const { x0, y0, step, nx, ny } = grid;
	const stride = nx + 1;
	const values = new Float64Array(stride * (ny + 1));
	for (let j = 0; j <= ny; j++)
		for (let i = 0; i <= nx; i++) values[j * stride + i] = field(x0 + i * step, y0 + j * step);
	const edgeCount = 2 * stride * (ny + 1);
	const link = new Int32Array(edgeCount).fill(-1);
	const crossings = new Map<number, Point>();
	const crossingOn = (edge: number): Point => {
		const known = crossings.get(edge);
		if (known !== undefined) return known;
		const a = edge >> 1;
		const b = edge & 1 ? a + stride : a + 1;
		const ax = x0 + (a % stride) * step;
		const ay = y0 + Math.floor(a / stride) * step;
		const bx = x0 + (b % stride) * step;
		const by = y0 + Math.floor(b / stride) * step;
		const t = findRoot(context, ax, ay, values[a]!, bx, by, values[b]!);
		const point: Point = [ax + (bx - ax) * t, ay + (by - ay) * t];
		crossings.set(edge, point);
		return point;
	};
	const corners = [0, 0, 0, 0];
	const sides = [0, 0, 0, 0];
	const hits = [0, 0, 0, 0];
	const hitInside = [false, false, false, false];
	for (let j = 0; j < ny; j++)
		for (let i = 0; i < nx; i++) {
			const c = j * stride + i;
			if (
				values[c]! < 0
					? values[c + 1]! < 0 && values[c + 1 + stride]! < 0 && values[c + stride]! < 0
					: values[c + 1]! >= 0 && values[c + 1 + stride]! >= 0 && values[c + stride]! >= 0
			)
				continue;
			corners[0] = c;
			corners[1] = c + 1;
			corners[2] = c + 1 + stride;
			corners[3] = c + stride;
			sides[0] = 2 * c;
			sides[1] = 2 * (c + 1) + 1;
			sides[2] = 2 * (c + stride);
			sides[3] = 2 * c + 1;
			let count = 0;
			for (let k = 0; k < 4; k++) {
				const inside = values[corners[k]!]! < 0;
				if (inside !== values[corners[(k + 1) & 3]!]! < 0) {
					hits[count] = sides[k]!;
					hitInside[count] = inside;
					count++;
				}
			}
			if (count === 2) {
				const from = +!hitInside[0];
				link[hits[from]!] = hits[1 - from]!;
			} else if (count === 4) {
				const centreInside = field(x0 + (i + 0.5) * step, y0 + (j + 0.5) * step) < 0;
				for (let k = 0; k < 4; k++) if (hitInside[k]) link[hits[k]!] = hits[(k + (centreInside ? 1 : 3)) & 3]!;
			}
		}
	const loops: Point[][] = [];
	const seen = new Uint8Array(edgeCount);
	for (let start = 0; start < edgeCount; start++) {
		if (link[start]! < 0 || seen[start]) continue;
		const loop: Point[] = [];
		let at = start;
		while (at >= 0 && !seen[at]) {
			seen[at] = 1;
			loop.push(crossingOn(at));
			at = link[at]!;
		}
		if (at === start) loops.push(loop);
	}
	return loops;
}

/** Illinois false position for the zero between two samples, as a fraction of the way. */
function findRoot(context: Context, ax: number, ay: number, fa: number, bx: number, by: number, fb: number): number {
	let low = 0;
	let lowValue = fa;
	let high = 1;
	let highValue = fb;
	let side = 0;
	let t = 0;
	for (let i = 0; i < ROOT_ITERATIONS; i++) {
		t = (low * highValue - high * lowValue) / (highValue - lowValue);
		const value = context.field(ax + (bx - ax) * t, ay + (by - ay) * t);
		if (Math.abs(value) <= context.root || high - low <= 1e-15) break;
		if (value < 0 === highValue < 0) {
			high = t;
			highValue = value;
			if (side === -1) lowValue /= 2;
			side = -1;
		} else {
			low = t;
			lowValue = value;
			if (side === 1) highValue /= 2;
			side = 1;
		}
	}
	return t;
}

/** Adds points where the straight edges stray from the contour. */
function refine(context: Context, loop: Point[]): Point[] {
	const points: Point[] = [];
	for (let i = 0; i < loop.length; i++) {
		const a = loop[i]!;
		const b = loop[(i + 1) % loop.length]!;
		if (a[0] !== b[0] || a[1] !== b[1]) {
			points.push(a);
			subdivide(context, a, b, 0, points);
		}
	}
	return points;
}

function subdivide(context: Context, a: Point, b: Point, depth: number, points: Point[]): void {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length = Math.sqrt(dx * dx + dy * dy);
	if (length === 0 || depth >= MAX_DEPTH || points.length >= MAX_POINTS) return;
	const mx = (a[0] + b[0]) / 2;
	const my = (a[1] + b[1]) / 2;
	const value = context.field(mx, my);
	if (!Number.isFinite(value)) return;
	const sign = value > 0 ? 1 : -1;
	const nx = (-dy / length) * sign;
	const ny = (dx / length) * sign;
	const distance = marchTo(context, mx, my, value, nx, ny);
	if (distance === null || (distance <= context.tolerance.deviation / 2 && length <= context.tolerance.edge)) return;
	const hit: Point =
		value > 0 ? alongGradient(context, mx, my, value, nx, ny, distance) : [mx + nx * distance, my + ny * distance];
	subdivide(context, a, hit, depth + 1, points);
	points.push(hit);
	subdivide(context, hit, b, depth + 1, points);
}

/** From outside, a shorter path to the contour along the field's gradient when it points the same way. */
function alongGradient(
	context: Context,
	x: number,
	y: number,
	value: number,
	nx: number,
	ny: number,
	distance: number,
): Point {
	const straight: Point = [x + nx * distance, y + ny * distance];
	const h = distance * 1e-3;
	const gx = context.field(x + h, y) - context.field(x - h, y);
	const gy = context.field(x, y + h) - context.field(x, y - h);
	const length = Math.sqrt(gx * gx + gy * gy);
	if (length === 0) return straight;
	const flip = gx * ny - gy * nx < 0 ? -1 : 1;
	const tx = (-gy / length) * flip;
	const ty = (gx / length) * flip;
	if (tx * nx + ty * ny < MIN_ALIGNMENT) return straight;
	const along = marchTo(context, x, y, value, tx, ty);
	return along === null || along * (tx * nx + ty * ny) <= distance ? straight : [x + tx * along, y + ty * along];
}

/** Sphere-traces from (x, y) along a direction to the zero crossing. */
function marchTo(context: Context, x: number, y: number, value: number, dx: number, dy: number): number | null {
	if (value === 0) return 0;
	let travelled = 0;
	let last = value;
	for (let i = 0; i < MARCH_STEPS; i++) {
		const next = travelled + Math.max(Math.abs(last), context.root);
		if (next > context.reach) return null;
		const px = x + dx * next;
		const py = y + dy * next;
		const v = context.field(px, py);
		if (v < 0 !== value < 0)
			return (
				travelled + (next - travelled) * findRoot(context, x + dx * travelled, y + dy * travelled, last, px, py, v)
			);
		travelled = next;
		last = v;
	}
	return null;
}

/** Douglas-Peucker on a closed loop, split at its farthest pair. */
function simplify(points: Point[], tolerance: Tolerance): Point[] {
	const count = points.length;
	if (count < 4) return points;
	const keep = new Uint8Array(count);
	let far = 0;
	let farthest = -1;
	for (let i = 1; i < count; i++) {
		const d = distanceSq(points[0]!, points[i]!);
		if (d > farthest) {
			farthest = d;
			far = i;
		}
	}
	keep[0] = 1;
	keep[far] = 1;
	const split = (from: number, to: number) => {
		if (to - from < 2) return;
		const a = points[from]!;
		const b = points[to % count]!;
		let worst = -1;
		let at = from;
		for (let i = from + 1; i < to; i++) {
			const d = segmentDistance(points[i]!, a, b);
			if (d > worst) {
				worst = d;
				at = i;
			}
		}
		const strays = worst > tolerance.deviation / 2;
		if (!strays && Math.sqrt(distanceSq(a, b)) <= tolerance.edge) return;
		if (!strays) at = (from + to) >> 1;
		keep[at] = 1;
		split(from, at);
		split(at, to);
	};
	split(0, far);
	split(far, count);
	return points.filter((_, i) => keep[i] === 1);
}

function distanceSq(a: Point, b: Point): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	return dx * dx + dy * dy;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
	const ex = b[0] - a[0];
	const ey = b[1] - a[1];
	const px = p[0] - a[0];
	const py = p[1] - a[1];
	const lengthSq = ex * ex + ey * ey;
	const t = lengthSq > 0 ? Math.min(1, Math.max(0, (px * ex + py * ey) / lengthSq)) : 0;
	const dx = px - ex * t;
	const dy = py - ey * t;
	return Math.sqrt(dx * dx + dy * dy);
}
