// Flat outlines of the shapes, drawn in a 228.541 unit box centred on `CENTRE`, and helpers to sample them.
import { HEART_PATH, SPARKLE_PATH, STAR_PATH } from "./data/outlines.ts";
import { round2, TAU, type Vec2 } from "./math.ts";

/** The centre (and half size) of the outline box. */
export const CENTRE = 114.2705;
const L = CENTRE;

const r2 = round2;
const clampTo = (value: number, low: number, high: number): number => (value < low ? low : value > high ? high : value);

/** Builds an SVG path, rounding every coordinate to two decimals. */
class PathBuilder {
	d = "";
	move(x: number, y: number): this {
		this.d += `M${r2(x)} ${r2(y)}`;
		return this;
	}
	line(x: number, y: number): this {
		this.d += `L${r2(x)} ${r2(y)}`;
		return this;
	}
	curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
		this.d += `C${r2(x1)} ${r2(y1)} ${r2(x2)} ${r2(y2)} ${r2(x)} ${r2(y)}`;
		return this;
	}
	/** Rounds the corner at `at` (between `before` and `after`) with a quadratic of `radius`. */
	corner(before: Vec2, at: Vec2, after: Vec2, radius: number): this {
		const unit = (to: Vec2, from: Vec2): Vec2 => {
			const dx = to[0] - from[0];
			const dy = to[1] - from[1];
			const length = Math.hypot(dx, dy) || 1;
			return [dx / length, dy / length];
		};
		const toBefore = unit(before, at);
		const toAfter = unit(after, at);
		const start: Vec2 = [at[0] + toBefore[0] * radius, at[1] + toBefore[1] * radius];
		const end: Vec2 = [at[0] + toAfter[0] * radius, at[1] + toAfter[1] * radius];
		if (this.d) this.line(start[0], start[1]);
		else this.move(start[0], start[1]);
		this.d += `Q${r2(at[0])} ${r2(at[1])} ${r2(end[0])} ${r2(end[1])}`;
		return this;
	}
	/** An elliptical arc from angle `from` to `to`, as cubic quarters. */
	arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): this {
		const pieces = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)));
		const step = (to - from) / pieces;
		const k = (4 / 3) * Math.tan(step / 4);
		let angle = from;
		for (let i = 0; i < pieces; i++) {
			const end = angle + step;
			const a: Vec2 = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
			const b: Vec2 = [cx + rx * Math.cos(end), cy + ry * Math.sin(end)];
			this.curve(
				a[0] - k * rx * Math.sin(angle),
				a[1] + k * ry * Math.cos(angle),
				b[0] + k * rx * Math.sin(end),
				b[1] - k * ry * Math.cos(end),
				b[0],
				b[1],
			);
			angle = end;
		}
		return this;
	}
	close(): string {
		return this.d + "Z";
	}
}

/** A smooth closed path through `points` (Catmull-Rom as cubics). */
function smoothClosed(points: Vec2[]): string {
	const count = points.length;
	let d = `M${r2(points[0]![0])} ${r2(points[0]![1])}`;
	for (let i = 0; i < count; i++) {
		const before = points[(i - 1 + count) % count]!;
		const from = points[i]!;
		const to = points[(i + 1) % count]!;
		const after = points[(i + 2) % count]!;
		d += `C${r2(from[0] + (to[0] - before[0]) / 6)} ${r2(from[1] + (to[1] - before[1]) / 6)} ${r2(to[0] - (after[0] - from[0]) / 6)} ${r2(to[1] - (after[1] - from[1]) / 6)} ${r2(to[0])} ${r2(to[1])}`;
	}
	return d + "Z";
}

const radial = (at: (angle: number) => Vec2, count = 128): string => {
	const points: Vec2[] = [];
	for (let i = 0; i < count; i++) points.push(at((i / count) * TAU));
	return smoothClosed(points);
};

function roundedPolygon(points: Vec2[], radius: number | number[]): string {
	const path = new PathBuilder();
	const count = points.length;
	for (let i = 0; i < count; i++) {
		const r = typeof radius === "number" ? radius : radius[i % radius.length]!;
		path.corner(points[(i - 1 + count) % count]!, points[i]!, points[(i + 1) % count]!, r);
	}
	return path.close();
}

const regularPolygon = (radius: number, sides: number, corner: number | number[], start = 0): string =>
	roundedPolygon(
		Array.from({ length: sides }, (_, i) => {
			const angle = start + (i / sides) * TAU;
			return [L + Math.cos(angle) * radius, L + Math.sin(angle) * radius] as Vec2;
		}),
		corner,
	);

/** The outer edge of a union of circles [x, y, r]. */
const circleUnion = (circles: [number, number, number][], count = 160): string =>
	radial((angle) => {
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		let reach = 0;
		for (const [x, y, r] of circles) {
			const dx = x - L;
			const dy = y - L;
			const along = cos * dx + sin * dy;
			const disc = along * along - (dx * dx + dy * dy) + r * r;
			if (disc <= 0) continue;
			const hit = along + Math.sqrt(disc);
			if (hit > reach) reach = hit;
		}
		return [L + cos * reach, L + sin * reach];
	}, count);

const superellipse = (rx: number, ry: number, exponent: number): string =>
	radial((angle) => {
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		return [
			L + Math.sign(cos) * Math.abs(cos) ** (2 / exponent) * rx,
			L + Math.sign(sin) * Math.abs(sin) ** (2 / exponent) * ry,
		];
	});

const wideStadium = (halfWidth: number, radius: number): string =>
	new PathBuilder()
		.move(L - halfWidth + radius, L - radius)
		.line(L + halfWidth - radius, L - radius)
		.arc(L + halfWidth - radius, L, radius, radius, -Math.PI / 2, Math.PI / 2)
		.line(L - halfWidth + radius, L + radius)
		.arc(L - halfWidth + radius, L, radius, radius, Math.PI / 2, (Math.PI * 3) / 2)
		.close();

const tallStadium = (radius: number, halfHeight: number): string =>
	new PathBuilder()
		.move(L - radius, L + halfHeight - radius)
		.line(L - radius, L - halfHeight + radius)
		.arc(L, L - halfHeight + radius, radius, radius, Math.PI, TAU)
		.line(L + radius, L + halfHeight - radius)
		.arc(L, L + halfHeight - radius, radius, radius, 0, Math.PI)
		.close();

const cylinder = (halfWidth: number, halfHeight: number, capHeight: number): string =>
	new PathBuilder()
		.move(L - halfWidth, L - halfHeight + capHeight)
		.arc(L, L - halfHeight + capHeight, halfWidth, capHeight, Math.PI, TAU)
		.line(L + halfWidth, L + halfHeight - capHeight)
		.arc(L, L + halfHeight - capHeight, halfWidth, capHeight, 0, Math.PI)
		.close();

function dome(halfWidth: number, halfHeight: number, corner: number): string {
	const bottom = L + halfHeight;
	return new PathBuilder()
		.move(L - halfWidth, bottom - corner)
		.arc(L, bottom - corner, halfWidth, 2 * halfHeight - corner, Math.PI, TAU)
		.line(L + halfWidth, bottom - corner)
		.curve(L + halfWidth, bottom, L + halfWidth, bottom, L + halfWidth - corner, bottom)
		.line(L - halfWidth + corner, bottom)
		.curve(L - halfWidth, bottom, L - halfWidth, bottom, L - halfWidth, bottom - corner)
		.close();
}

function arch(halfWidth: number, halfHeight: number, corner: number): string {
	const bottom = L + halfHeight;
	const top = L - halfHeight + halfWidth;
	return new PathBuilder()
		.move(L - halfWidth, top)
		.arc(L, top, halfWidth, halfWidth, Math.PI, TAU)
		.line(L + halfWidth, bottom - corner)
		.curve(L + halfWidth, bottom, L + halfWidth, bottom, L + halfWidth - corner, bottom)
		.line(L - halfWidth + corner, bottom)
		.curve(L - halfWidth, bottom, L - halfWidth, bottom, L - halfWidth, bottom - corner)
		.close();
}

function shield(halfWidth: number, halfHeight: number, shoulder: number): string {
	const top = L - halfHeight;
	const bottom = L + halfHeight;
	return new PathBuilder()
		.move(L - halfWidth, top + shoulder)
		.curve(L - halfWidth, top - 2, L - halfWidth * 0.5, top - 10, L, top - 10)
		.curve(L + halfWidth * 0.5, top - 10, L + halfWidth, top - 2, L + halfWidth, top + shoulder)
		.curve(L + halfWidth, L + halfHeight * 0.42, L + halfWidth * 0.62, bottom, L, bottom)
		.curve(L - halfWidth * 0.62, bottom, L - halfWidth, L + halfHeight * 0.42, L - halfWidth, top + shoulder)
		.close();
}

const egg = (rx: number, ry: number, taper: number): string =>
	radial((angle) => {
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const upper = (1 - sin) / 2;
		return [L + cos * rx * (1 - taper * upper * upper), L + sin * ry];
	});

function teardrop(radius: number, tipY: number, centreY: number, corner: number): string {
	const sin = clampTo(radius / (centreY - tipY), -1, 1);
	const cos = Math.sqrt(1 - sin * sin);
	const right: Vec2 = [L + radius * cos, centreY - radius * sin];
	const left: Vec2 = [L - radius * cos, centreY - radius * sin];
	const angle = Math.atan2(right[1] - centreY, right[0] - L);
	return new PathBuilder()
		.corner(right, [L, tipY], left, corner)
		.line(left[0], left[1])
		.arc(L, centreY, radius, radius, Math.PI - angle, angle)
		.close();
}

const roundedSquare = (half: number, corner: number): string =>
	roundedPolygon(
		[
			[L - half, L - half],
			[L + half, L - half],
			[L + half, L + half],
			[L - half, L + half],
		],
		corner,
	);

const house = (halfWidth: number, halfHeight: number, eave: number, corner: number): string =>
	roundedPolygon(
		[
			[L - halfWidth, L + halfHeight],
			[L + halfWidth, L + halfHeight],
			[L + halfWidth, L - halfHeight + eave],
			[L, L - halfHeight],
			[L - halfWidth, L - halfHeight + eave],
		],
		corner,
	);

const clover = (offset: number, radius: number): string =>
	circleUnion([
		[L - offset, L - offset, radius],
		[L + offset, L - offset, radius],
		[L + offset, L + offset, radius],
		[L - offset, L + offset, radius],
	]);

const leaf = (rx: number, ry: number, sharpness: number): string =>
	radial((angle) => {
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		return [L + cos * rx * Math.max(1 - sin * sin, 0) ** (sharpness / 2 - 0.5) * 1, L + sin * ry];
	});

const bean = (rx: number, ry: number, dent: number, dentAngle: number): string =>
	radial((angle) => {
		const near = (centre: number) => {
			const gap = Math.abs(((((angle - centre + Math.PI) % TAU) + TAU) % TAU) - Math.PI);
			return Math.exp(-(gap * gap) / 0.4232);
		};
		const scale = 1 - dent * near(dentAngle) + dent * 0.34 * near(dentAngle + Math.PI);
		return [L + Math.cos(angle) * rx * scale, L + Math.sin(angle) * ry * scale];
	});

const pebble = (radius: number, wobble: number, phase: number): string =>
	radial((angle) => {
		const r = radius * (1 + wobble * (Math.sin(angle * 2 + phase) * 0.6 + Math.sin(angle * 3 - phase) * 0.4));
		return [L + Math.cos(angle) * r, L + Math.sin(angle) * r * 0.98];
	});

/** Flattens an absolute M/L/C/Q/Z path into points about `step` apart. */
export function flatten(d: string, step = 4): Vec2[] {
	const tokens = d.match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
	const points: Vec2[] = [];
	let i = 0;
	let command = "";
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	const read = () => parseFloat(tokens[i++]!);
	const emit = (at: (t: number) => Vec2, length: number) => {
		const count = Math.max(2, Math.ceil(length / step));
		for (let k = 1; k <= count; k++) points.push(at(k / count));
	};
	while (i < tokens.length) {
		if (/[a-z]/i.test(tokens[i]!)) command = tokens[i++]!.toUpperCase();
		if (command === "Z") {
			if (Math.hypot(startX - x, startY - y) > 0.01)
				emit((t) => [x + (startX - x) * t, y + (startY - y) * t], Math.hypot(startX - x, startY - y));
			x = startX;
			y = startY;
		} else {
			if (i >= tokens.length) break;
			if (command === "M") {
				x = read();
				y = read();
				startX = x;
				startY = y;
				points.push([x, y]);
				command = "L";
			} else if (command === "L") {
				const tx = read();
				const ty = read();
				emit((t) => [x + (tx - x) * t, y + (ty - y) * t], Math.hypot(tx - x, ty - y));
				x = tx;
				y = ty;
			} else if (command === "Q") {
				const cx = read();
				const cy = read();
				const tx = read();
				const ty = read();
				const fx = x;
				const fy = y;
				emit(
					(t) => {
						const u = 1 - t;
						return [u * u * fx + 2 * u * t * cx + t * t * tx, u * u * fy + 2 * u * t * cy + t * t * ty];
					},
					Math.hypot(cx - x, cy - y) + Math.hypot(tx - cx, ty - cy),
				);
				x = tx;
				y = ty;
			} else {
				const c1x = read();
				const c1y = read();
				const c2x = read();
				const c2y = read();
				const tx = read();
				const ty = read();
				const fx = x;
				const fy = y;
				emit(
					(t) => {
						const u = 1 - t;
						return [
							u * u * u * fx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx,
							u * u * u * fy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ty,
						];
					},
					Math.hypot(c1x - x, c1y - y) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(tx - c2x, ty - c2y),
				);
				x = tx;
				y = ty;
			}
		}
	}
	return points;
}

/** Horizontal spans of a polygon, sampled on `rows` scanlines: inner span (either side of centre) and outer span. */
function scanlines(points: Vec2[], rows = 160) {
	let top = Infinity;
	let bottom = -Infinity;
	for (const p of points) {
		if (p[1] < top) top = p[1];
		if (p[1] > bottom) bottom = p[1];
	}
	const height = bottom - top;
	const rowY = (row: number) => top + (height * (row + 0.5)) / rows;
	const innerLeft = new Float64Array(rows);
	const innerRight = new Float64Array(rows);
	const outerLeft = new Float64Array(rows);
	const outerRight = new Float64Array(rows);
	for (let row = 0; row < rows; row++) {
		const y = rowY(row);
		let left = -Infinity;
		let right = Infinity;
		let minX = Infinity;
		let maxX = -Infinity;
		for (let k = 0; k < points.length; k++) {
			const a = points[k]!;
			const b = points[(k + 1) % points.length]!;
			if (a[1] <= y === b[1] <= y) continue;
			const x = a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
			if (x <= 114.2705) {
				if (x > left) left = x;
			} else if (x < right) right = x;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
		}
		innerLeft[row] = Number.isFinite(left) ? left : L;
		innerRight[row] = Number.isFinite(right) ? right : L;
		outerLeft[row] = Number.isFinite(minX) ? minX : L;
		outerRight[row] = Number.isFinite(maxX) ? maxX : L;
	}
	const at =
		(left: Float64Array, right: Float64Array) =>
		(y: number): Vec2 => {
			const position = clampTo(((y - top) / height) * rows - 0.5, 0, rows - 1);
			const row = Math.floor(position);
			const t = position - row;
			const next = Math.min(row + 1, rows - 1);
			return [left[row]! + (left[next]! - left[row]!) * t, right[row]! + (right[next]! - right[row]!) * t];
		};
	return { top, bottom, spanAt: at(innerLeft, innerRight), outerAt: at(outerLeft, outerRight) };
}

const RING_SAMPLES = 96;

/** The polygon's farthest reach from the centre in each of 96 directions. */
const radialRing = (points: Vec2[]): Vec2[] =>
	Array.from({ length: RING_SAMPLES }, (_, i) => {
		const angle = (i / RING_SAMPLES) * TAU;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		let reach = 0;
		for (let k = 0; k < points.length; k++) {
			const a = points[k]!;
			const b = points[(k + 1) % points.length]!;
			const ax = a[0] - L;
			const ay = a[1] - L;
			const bx = b[0] - L;
			const by = b[1] - L;
			const det = (bx - ax) * sin - (by - ay) * cos;
			if (Math.abs(det) < 1e-9) continue;
			const t = (ax * sin - ay * cos) / -det;
			if (t < 0 || t > 1) continue;
			const hit = (ax + (bx - ax) * t) * cos + (ay + (by - ay) * t) * sin;
			if (hit > reach) reach = hit;
		}
		return [L + cos * reach, L + sin * reach] as Vec2;
	});

/** Scales a path about the centre by `scale` after shifting x by `dx` and y by `dy`. */
const transformPath = (d: string, scale: number, dx: number, dy: number): string => {
	let isX = 0;
	return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (number) => {
		isX ^= 1;
		const value = parseFloat(number) + (isX ? dx : dy);
		return String(r2(L + (value - L) * scale));
	});
};

const FIT_SIZE = 228.44;

function fitOf(points: Vec2[]) {
	let x0 = Infinity;
	let x1 = -Infinity;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (const p of points) {
		if (p[0] < x0) x0 = p[0];
		if (p[0] > x1) x1 = p[0];
		if (p[1] < y0) y0 = p[1];
		if (p[1] > y1) y1 = p[1];
	}
	return {
		scale: clampTo(FIT_SIZE / Math.max(x1 - x0, y1 - y0), 0.9, 1.35),
		dx: L - (x0 + x1) / 2,
		dy: L - (y0 + y1) / 2,
	};
}

/** Centres a path in the box and scales it to fill it. */
function fit(d: string, points: Vec2[]): string {
	const { scale, dx, dy } = fitOf(points);
	return Math.abs(scale - 1) < 5e-3 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? d : transformPath(d, scale, dx, dy);
}

export interface Outline {
	path: string;
	ring: Vec2[];
	top: number;
	bottom: number;
	spanAt: (y: number) => Vec2;
	/** Half the widest horizontal span. */
	beltRadius: number;
}

function outlineOf(d: string): Outline {
	const path = fit(d, flatten(d));
	const points = flatten(path);
	const { top, bottom, spanAt, outerAt } = scanlines(points);
	let belt = 0;
	for (let y = top; y <= bottom; y += 2) {
		const [left, right] = outerAt(y);
		belt = Math.max(belt, (right - left) / 2);
	}
	return { path, ring: radialRing(points), top: r2(top), bottom: r2(bottom), spanAt, beltRadius: r2(belt) };
}

const DRAWN = {
	pebble: () => pebble(108, 0.075, 1.1),
	bean: () => bean(94, 112, 0.34, Math.PI),
	egg: () => egg(98, 113, 0.22),
	squircle: () => superellipse(107, 107, 3.2),
	square: () => roundedSquare(107, 28),
	tablet: () => wideStadium(114, 74),
	capsule: () => tallStadium(72, 113),
	cylinder: () => cylinder(94, 110, 48),
	hex: () => regularPolygon(114, 6, 20, Math.PI / 6),
	gem: () => superellipse(112, 113, 1.5),
	shield: () => shield(98, 108, 30),
	dome: () => dome(114, 82, 26),
	arch: () => arch(76, 113, 42),
	cloud: () =>
		circleUnion([
			[L - 62, L + 26, 56],
			[L + 62, L + 26, 54],
			[L, L + 34, 62],
			[L - 24, L - 30, 62],
			[L + 38, L - 26, 54],
		]),
	leaf: () => leaf(88, 113, 1.5),
	clover: () => clover(38, 58),
	house: () => house(100, 110, 78, 29),
	heart: () => HEART_PATH,
	sparkle: () => SPARKLE_PATH,
	star6: () => STAR_PATH,
} satisfies Record<string, () => string>;
export type DrawnShape = keyof typeof DRAWN;

const outlines = new Map<DrawnShape, Outline>();

export function outline(name: DrawnShape): Outline {
	const cached = outlines.get(name);
	if (cached != null) return cached;
	const built = outlineOf(DRAWN[name]());
	outlines.set(name, built);
	return built;
}

/** A shape's outline as points about `step` apart. */
export const outlinePoints = (name: DrawnShape, step = 4): Vec2[] => flatten(outline(name).path, step);

export const teardropOutline = (radius: number, corner: number): Outline =>
	outlineOf(teardrop(radius, L - 114, L + 26, corner));
export const wedgeOutline = (side: number, tip: number): Outline =>
	outlineOf(regularPolygon(130, 3, [tip, side, side], -Math.PI / 2));
