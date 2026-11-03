// The round blob: an ellipse body with eyes painted on the sphere, clipped to the visible half and the squashed outline.
import { contours } from "./contour.ts";
import type { Eye } from "./face.ts";
import { EYE_FRAMES, type EyeFrame, fmt2, mat3Apply, type Mat3, quatToMatrix, type Vec2, type Vec3 } from "./math.ts";
import type { Frame } from "./motion.ts";

type Segment = { kind: "line"; to: Vec2 } | { kind: "arc"; to: Vec2; radii: Vec2; sweep: number };

const UNIT: Vec2 = [1, 1];
const MAX_ARC = Math.PI * 0.999;
const OUTLINE_POINTS = 192;
const ARC_STEP = Math.PI / 48;

/** Whether an eye frame is left-handed, so its outlines run backward after mapping. */
const isMirrored = ({ M, T, C }: EyeFrame): boolean => {
	const n = [C[1] * T[2] - C[2] * T[1], C[2] * T[0] - C[0] * T[2], C[0] * T[1] - C[1] * T[0]];
	return n[0]! * M[0] + n[1]! * M[1] + n[2]! * M[2] < 0;
};
const MIRRORED = EYE_FRAMES.map(isMirrored);

// ─── Eye outlines in eye space ──────────────────────────────────────────────

const BASE_TOLERANCE = 0.02;
const MAX_LEVEL = 16;
const MIN_CELL = 0.015;
const MAX_CELLS = 400;
const CACHE_LIMIT = 512;
const SEGMENT_STRIDE = 5;
const outlineCache = new Map<string, Vec2[][]>();

/** An eye's outline, traced finely enough for `pixels` of eye on screen. */
function eyeOutline(eye: Eye, pixels: number): Vec2[][] {
	const level = Math.min(MAX_LEVEL, Math.max(0, Math.ceil(Math.log2(Math.max(pixels, 1)))));
	const key = `${level}|${eye.wid}|${eye.oval.join()}|${eye.ovalMix}|${eye.pts.join()}`;
	const cached = outlineCache.get(key);
	if (cached !== undefined) {
		outlineCache.delete(key);
		outlineCache.set(key, cached);
		return cached;
	}
	const traced = trace(eyeField(eye), BASE_TOLERANCE / 2 ** level);
	outlineCache.set(key, traced);
	if (outlineCache.size > CACHE_LIMIT) {
		const oldest = outlineCache.keys().next();
		if (oldest.done !== true) outlineCache.delete(oldest.value);
	}
	return traced;
}

interface EyeField {
	segments: Float64Array;
	halfWidth: number;
	rx: number;
	ry: number;
	ellipseMix: number;
}

const blend = (low: number, high: number, value: number): number => {
	const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
	return t * t * (3 - 2 * t);
};

function eyeField(eye: Eye): EyeField {
	const [rx, ry] = eye.oval;
	const ellipseMix =
		rx > 1e-5 && ry > 1e-5 ? (eye.ovalMix > 1e-4 ? Math.min(1, eye.ovalMix) : blend(0, 0.08, Math.min(rx, ry))) : 0;
	const count = Math.max(0, eye.pts.length - 1);
	const segments = new Float64Array(count * SEGMENT_STRIDE);
	for (let i = 0; i < count; i++) {
		const [x, y] = eye.pts[i]!;
		const dx = eye.pts[i + 1]![0] - x;
		const dy = eye.pts[i + 1]![1] - y;
		const lengthSq = dx * dx + dy * dy;
		segments.set([x, y, dx, dy, lengthSq > 0 ? 1 / lengthSq : 0], i * SEGMENT_STRIDE);
	}
	return { segments, halfWidth: eye.wid > 0 ? eye.wid : -1, rx, ry, ellipseMix };
}

function eyeDistance(field: EyeField, x: number, y: number): number {
	const stroke = spineDistance(field.segments, x, y) - field.halfWidth;
	if (field.ellipseMix === 0) return stroke;
	const ex = x / field.rx;
	const ey = y / field.ry;
	const oval = (Math.sqrt(ex * ex + ey * ey) - 1) * Math.min(field.rx, field.ry);
	return stroke * (1 - field.ellipseMix) + oval * field.ellipseMix;
}

function spineDistance(segments: Float64Array, x: number, y: number): number {
	let best = 1e6;
	for (let i = 0; i < segments.length; i += SEGMENT_STRIDE) {
		const px = x - segments[i]!;
		const py = y - segments[i + 1]!;
		const dx = segments[i + 2]!;
		const dy = segments[i + 3]!;
		const t = (px * dx + py * dy) * segments[i + 4]!;
		const along = t < 0 ? 0 : t > 1 ? 1 : t;
		const ox = px - dx * along;
		const oy = py - dy * along;
		const d = ox * ox + oy * oy;
		if (d < best) best = d;
	}
	return Math.sqrt(best);
}

function trace(field: EyeField, deviation: number): Vec2[][] {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	let thinnest = Infinity;
	const { segments, halfWidth } = field;
	if (halfWidth > 0 && field.ellipseMix < 1 && segments.length > 0) {
		for (let i = 0; i < segments.length; i += SEGMENT_STRIDE)
			for (const [x, y] of [
				[segments[i]!, segments[i + 1]!],
				[segments[i]! + segments[i + 2]!, segments[i + 1]! + segments[i + 3]!],
			] as const) {
				x0 = Math.min(x0, x - halfWidth);
				y0 = Math.min(y0, y - halfWidth);
				x1 = Math.max(x1, x + halfWidth);
				y1 = Math.max(y1, y + halfWidth);
			}
		thinnest = halfWidth;
	}
	if (field.ellipseMix > 0) {
		x0 = Math.min(x0, -field.rx);
		y0 = Math.min(y0, -field.ry);
		x1 = Math.max(x1, field.rx);
		y1 = Math.max(y1, field.ry);
		thinnest = Math.min(thinnest, field.rx, field.ry);
	}
	if (!(x1 > x0 && y1 > y0)) return [];
	const step = Math.max(Math.min(MIN_CELL, thinnest / 3), Math.max(x1 - x0, y1 - y0) / MAX_CELLS);
	return contours(
		(x, y) => eyeDistance(field, x, y),
		{
			x0: x0 - 2 * step,
			y0: y0 - 2 * step,
			step,
			nx: Math.ceil((x1 - x0) / step) + 4,
			ny: Math.ceil((y1 - y0) / step) + 4,
		},
		{ deviation, edge: Math.sqrt(4 * deviation) },
	);
}

// ─── Eyes on the sphere ─────────────────────────────────────────────────────

/** Maps an eye outline onto the sphere and keeps the part facing the viewer, as unit-circle segments. */
function eyeOnSphere(eye: Eye, frame: EyeFrame, mirrored: boolean, rotation: Mat3, pixels: number): Segment[][] {
	const loops = eyeOutline(eye, pixels * Math.max(1, eye.lidY));
	if (loops.length === 0) return [];
	const centre = mat3Apply(rotation, frame.M);
	const across = mat3Apply(rotation, frame.C);
	const along = mat3Apply(rotation, frame.T);
	const facing = Math.atan2(centre[1], centre[0]);
	const cos = Math.cos(eye.tilt);
	const sin = Math.sin(eye.tilt);
	const [ox, oy] = eye.off;
	const onSphere = ([x, y]: Vec2): Vec3 => {
		const lifted = y * eye.lidY;
		const u = ox + cos * x + sin * lifted;
		const v = oy - sin * x + cos * lifted;
		const angle = Math.sqrt(u * u + v * v);
		const k = angle > 1e-12 ? Math.sin(angle) / angle : 1;
		const c = Math.cos(angle);
		return [
			c * centre[0] + k * (u * across[0] + v * along[0]),
			c * centre[1] + k * (u * across[1] + v * along[1]),
			c * centre[2] + k * (u * across[2] + v * along[2]),
		];
	};
	const result: Segment[][] = [];
	for (const loop of loops) {
		const points = loop.map(onSphere);
		if (mirrored) points.reverse();
		const visible = frontHalf(points, facing);
		if (visible !== null) result.push(visible);
	}
	return result;
}

/** Where the edge from `a` to `b` crosses the silhouette (z = 0), on the unit circle. */
function horizonPoint(a: Vec3, b: Vec3): Vec2 {
	const t = a[2] / (a[2] - b[2]);
	const x = a[0] + (b[0] - a[0]) * t;
	const y = a[1] + (b[1] - a[1]) * t;
	const length = Math.sqrt(x * x + y * y);
	return [x / length, y / length];
}

const wrapAngle = (angle: number): number => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
const positiveAngle = (angle: number): number => {
	const t = angle % (2 * Math.PI);
	return t < 0 ? t + 2 * Math.PI : t;
};

function horizonArc(from: Vec2, to: Vec2, facing: number): Segment {
	return {
		kind: "arc",
		to,
		radii: UNIT,
		sweep: wrapAngle(Math.atan2(to[1], to[0]) - facing) - wrapAngle(Math.atan2(from[1], from[0]) - facing),
	};
}

/** Clips a loop on the sphere to the visible hemisphere, closing it along the silhouette. */
function frontHalf(points: Vec3[], facing: number): Segment[] | null {
	const count = points.length;
	let start = -1;
	for (let i = 0; i < count && start < 0; i++) if (points[i]![2] <= 0 && points[(i + 1) % count]![2] > 0) start = i;
	if (start < 0)
		return count === 0 || points[0]![2] <= 0 ? null : points.map(([x, y]) => ({ kind: "line", to: [x, y] }));
	const segments: Segment[] = [];
	let entry: Vec2 = [1, 0];
	let exit: Vec2 | null = null;
	for (let i = 0; i < count; i++) {
		const a = points[(start + i) % count]!;
		const b = points[(start + i + 1) % count]!;
		const aFront = a[2] > 0;
		const bFront = b[2] > 0;
		if (aFront && bFront) segments.push({ kind: "line", to: [b[0], b[1]] });
		else if (aFront) {
			exit = horizonPoint(a, b);
			segments.push({ kind: "line", to: exit });
		} else if (bFront) {
			const enter = horizonPoint(a, b);
			if (exit === null) entry = enter;
			else segments.push(horizonArc(exit, enter, facing));
			segments.push({ kind: "line", to: [b[0], b[1]] });
		}
	}
	if (exit !== null) segments.push(horizonArc(exit, entry, facing));
	return segments;
}

function ellipsePoint(radii: Vec2, angle: number): Vec2 {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const r = 1 / Math.sqrt((cos * cos) / (radii[0] * radii[0]) + (sin * sin) / (radii[1] * radii[1]));
	return [r * cos, r * sin];
}

const lerpPoint = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Where a line from `a` to `b` crosses the ellipse x²·kx + y²·ky = 1, as fractions in (0, 1). */
function lineCrossings(a: Vec2, b: Vec2, kx: number, ky: number): number[] {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const qa = kx * dx * dx + ky * dy * dy;
	const qb = kx * a[0] * dx + ky * a[1] * dy;
	const qc = kx * a[0] * a[0] + ky * a[1] * a[1] - 1;
	const disc = qb * qb - qa * qc;
	if (qa === 0 || disc <= 0) return [];
	const root = Math.sqrt(disc);
	const q = -(qb + (qb < 0 ? -root : root));
	return [q / qa, qc / q].filter((t) => t > 0 && t < 1).sort((x, y) => x - y);
}

/** Where a circular arc of `radius` crosses the ellipse, as fractions of its sweep. */
function arcCrossings(radius: number, start: number, sweep: number, kx: number, ky: number): number[] {
	if (kx === ky || sweep === 0) return [];
	const cosSq = (1 / (radius * radius) - ky) / (kx - ky);
	if (!(cosSq > 0 && cosSq < 1)) return [];
	const angle = Math.acos(Math.sqrt(cosSq));
	const fractions: number[] = [];
	for (const at of [angle, -angle, Math.PI - angle, Math.PI + angle]) {
		const t = positiveAngle(sweep > 0 ? at - start : start - at) / Math.abs(sweep);
		if (t > 0 && t < 1) fractions.push(t);
	}
	return fractions.sort((x, y) => x - y);
}

interface Piece {
	from: Vec2;
	segment: Segment;
	sweep: number;
	isInside: boolean;
}

/** Cuts a loop wherever it crosses the ellipse, marking each piece inside or outside. */
function piecesAgainst(segments: Segment[], radii: Vec2): Piece[] {
	const kx = 1 / (radii[0] * radii[0]);
	const ky = 1 / (radii[1] * radii[1]);
	const level = (p: Vec2) => kx * p[0] * p[0] + ky * p[1] * p[1] - 1;
	const pieces: Piece[] = [];
	let at = segments[segments.length - 1]!.to;
	for (const segment of segments) {
		if (segment.kind === "line") {
			const cuts = lineCrossings(at, segment.to, kx, ky);
			let from = at;
			for (let i = 0; i <= cuts.length; i++) {
				const t0 = i === 0 ? 0 : cuts[i - 1]!;
				const t1 = i === cuts.length ? 1 : cuts[i]!;
				const to = i === cuts.length ? segment.to : lerpPoint(at, segment.to, t1);
				pieces.push({
					from,
					segment: { kind: "line", to },
					sweep: Math.atan2(from[0] * to[1] - from[1] * to[0], from[0] * to[0] + from[1] * to[1]),
					isInside: level(lerpPoint(at, segment.to, (t0 + t1) / 2)) < 0,
				});
				from = to;
			}
		} else {
			const radius = segment.radii[0];
			const start = Math.atan2(at[1], at[0]);
			const cuts = arcCrossings(radius, start, segment.sweep, kx, ky);
			let from = at;
			for (let i = 0; i <= cuts.length; i++) {
				const t0 = i === 0 ? 0 : cuts[i - 1]!;
				const t1 = i === cuts.length ? 1 : cuts[i]!;
				const end = start + segment.sweep * t1;
				const to: Vec2 = i === cuts.length ? segment.to : [radius * Math.cos(end), radius * Math.sin(end)];
				const middle = start + (segment.sweep * (t0 + t1)) / 2;
				const sweep = segment.sweep * (t1 - t0);
				pieces.push({
					from,
					segment: { kind: "arc", to, radii: segment.radii, sweep },
					sweep,
					isInside: level([radius * Math.cos(middle), radius * Math.sin(middle)]) < 0,
				});
				from = to;
			}
		}
		at = segment.to;
	}
	return pieces;
}

const fullEllipse = (radii: Vec2, direction: number): Segment[] => [
	{ kind: "arc", to: [-radii[0], 0], radii, sweep: direction * Math.PI },
	{ kind: "arc", to: [radii[0], 0], radii, sweep: direction * Math.PI },
];

/** Clips a loop to the inside of the squashed body ellipse, following the rim where it leaves. */
function clipToBody(segments: Segment[], radii: Vec2): Segment[] | null {
	const pieces = piecesAgainst(segments, radii);
	const count = pieces.length;
	if (pieces.every((p) => p.isInside)) return segments;
	let start = -1;
	for (let i = 0; i < count && start < 0; i++)
		if (pieces[i]!.isInside && !pieces[(i + count - 1) % count]!.isInside) start = i;
	if (start < 0) {
		const turn = pieces.reduce((sum, p) => sum + p.sweep, 0);
		return Math.abs(turn) > Math.PI ? fullEllipse(radii, Math.sign(turn)) : null;
	}
	const result: Segment[] = [];
	let leftAt: Vec2 | null = null;
	let rimSweep = 0;
	for (let i = 0; i < count; i++) {
		const piece = pieces[(start + i) % count]!;
		if (piece.isInside) {
			if (leftAt !== null) result.push({ kind: "arc", to: piece.from, radii, sweep: rimSweep });
			leftAt = null;
			result.push(piece.segment);
		} else {
			if (leftAt === null) {
				leftAt = piece.from;
				rimSweep = 0;
			}
			rimSweep += piece.sweep;
		}
	}
	if (leftAt !== null) result.push({ kind: "arc", to: pieces[start]!.from, radii, sweep: rimSweep });
	return result;
}

interface Run {
	from: Vec2;
	to: Vec2;
	segments: Segment[];
}

/** The body with the eyes cut out: the rim, split where eyes touch it, plus each eye's inner edge reversed. */
function bodyWithHoles(radii: Vec2, loops: Segment[][]): Segment[][] {
	const isRim = (s: Segment) => s.kind === "arc" && s.radii[0] === radii[0] && s.radii[1] === radii[1];
	const holes: Segment[][] = [];
	const runs: Run[] = [];
	const rimArcs: { from: Vec2; sweep: number }[] = [];
	const rimPoints: Vec2[] = [];
	for (const loop of loops) {
		const first = loop.findIndex(isRim);
		if (first < 0) {
			holes.push(loop);
			continue;
		}
		let runStart = loop[first]!.to;
		let run: Segment[] = [];
		let at = runStart;
		for (let i = 1; i <= loop.length; i++) {
			const s = loop[(first + i) % loop.length]!;
			if (isRim(s)) {
				rimArcs.push({ from: at, sweep: (s as Extract<Segment, { kind: "arc" }>).sweep });
				rimPoints.push(at, s.to);
				if (run.length > 0) runs.push(reversedRun(runStart, run));
				run = [];
				runStart = s.to;
			} else run.push(s);
			at = s.to;
		}
	}
	return rimArcs.length === 0
		? [fullEllipse(radii, 1), ...holes]
		: [...chain([...runs, ...openRim(radii, rimArcs, rimPoints)]), ...holes];
}

function reversedRun(start: Vec2, segments: Segment[]): Run {
	const points = [start, ...segments.map((s) => s.to)];
	const reversed = segments
		.map((s, i): Segment =>
			s.kind === "line" ? { kind: "line", to: points[i]! } : { ...s, to: points[i]!, sweep: -s.sweep },
		)
		.reverse();
	return { from: points[points.length - 1]!, to: start, segments: reversed };
}

/** The rim arcs between eye touch points that no eye covers. */
function openRim(radii: Vec2, covered: { from: Vec2; sweep: number }[], points: Vec2[]): Run[] {
	const sorted = points
		.map((point) => ({ point, angle: positiveAngle(Math.atan2(point[1], point[0])) }))
		.sort((a, b) => a.angle - b.angle);
	const runs: Run[] = [];
	for (let i = 0; i < sorted.length; i++) {
		const a = sorted[i]!;
		const b = sorted[(i + 1) % sorted.length]!;
		const sweep = i + 1 < sorted.length ? b.angle - a.angle : b.angle + 2 * Math.PI - a.angle;
		if (sweep <= 0) continue;
		const middle = a.angle + sweep / 2;
		if (covered.reduce((sum, arc) => sum + coverage(arc, middle), 0) === 0)
			runs.push({ from: a.point, to: b.point, segments: [{ kind: "arc", to: b.point, radii, sweep }] });
	}
	return runs;
}

function coverage(arc: { from: Vec2; sweep: number }, angle: number): number {
	const start = Math.atan2(arc.from[1], arc.from[0]);
	return (arc.sweep > 0 ? positiveAngle(angle - start) : positiveAngle(start - angle)) < Math.abs(arc.sweep)
		? Math.sign(arc.sweep)
		: 0;
}

/** Joins runs end to start into closed loops. */
function chain(runs: Run[]): Segment[][] {
	const key = (p: Vec2) => `${p[0]} ${p[1]}`;
	const byStart = new Map<string, Run[]>();
	for (const run of runs) {
		const list = byStart.get(key(run.from));
		if (list === undefined) byStart.set(key(run.from), [run]);
		else list.push(run);
	}
	const used = new Set<Run>();
	const loops: Segment[][] = [];
	for (const first of runs) {
		const loop: Segment[] = [];
		let run: Run | undefined = first;
		while (run !== undefined && !used.has(run)) {
			used.add(run);
			loop.push(...run.segments);
			run = byStart.get(key(run.to))?.find((r) => !used.has(r));
		}
		if (loop.length > 0) loops.push(loop);
	}
	return loops;
}

/** Each eye's visible outline on the sphere, in unit sphere space (y up). */
export function sphereEyes(frame: Frame, pixels: number): Segment[][] {
	if (frame.eyes === null) return [];
	const rotation = quatToMatrix(frame.quat);
	const radii: Vec2 = [Math.abs(frame.squash[0]), Math.abs(frame.squash[1])];
	const isSquashed = radii[0] < 1 || radii[1] < 1;
	const loops: Segment[][] = [];
	frame.eyes.forEach((eye, i) => {
		for (const loop of eyeOnSphere(eye, EYE_FRAMES[i]!, MIRRORED[i]!, rotation, pixels)) {
			const clipped = isSquashed ? clipToBody(loop, radii) : loop;
			if (clipped !== null) loops.push(clipped);
		}
	});
	return loops;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

function arcCommand(
	from: Vec2,
	arc: Extract<Segment, { kind: "arc" }>,
	point: (p: Vec2) => string,
	scale: number,
): string {
	if (arc.sweep === 0) return "";
	if (Math.abs(arc.sweep) > MAX_ARC) {
		const half = arc.sweep / 2;
		const middle = ellipsePoint(arc.radii, Math.atan2(from[1], from[0]) + half);
		return (
			arcCommand(from, { ...arc, to: middle, sweep: half }, point, scale) +
			arcCommand(middle, { ...arc, sweep: half }, point, scale)
		);
	}
	return `A${`${fmt2(arc.radii[0] * scale)} ${fmt2(arc.radii[1] * scale)}`} 0 0 ${arc.sweep > 0 ? 0 : 1} ${point(arc.to)}`;
}

function loopPath(segments: Segment[], point: (p: Vec2) => string, scale: number): string {
	let at = segments[segments.length - 1]!.to;
	let d = `M${point(at)}`;
	for (const s of segments) {
		d += s.kind === "line" ? `L${point(s.to)}` : arcCommand(at, s, point, scale);
		at = s.to;
	}
	return `${d}Z`;
}

export interface SpherePaths {
	size: number;
	body: string;
	eyes: string;
}

/** The blob's body and eye paths in a `size` pixel square. Cut-out eyes become holes in the body. */
export function spherePaths(frame: Frame, size: number, isCutout: boolean): SpherePaths {
	const radius = (frame.zoom * size) / 2;
	const [sx, sy] = frame.squash;
	if (radius === 0 || sx === 0 || sy === 0) return { size, body: "", eyes: "" };
	const radii: Vec2 = [Math.abs(sx), Math.abs(sy)];
	const cx = size / 2 + radius * frame.offset[0];
	const cy = size / 2 - radius * (frame.squashAnchor * (1 - sy) + frame.offset[1]);
	const point = (p: Vec2) => `${fmt2(cx + p[0] * radius)} ${fmt2(cy - p[1] * radius)}`;
	const paths = (loops: Segment[][]) => loops.map((loop) => loopPath(loop, point, Math.abs(radius))).join("");
	const eyes = sphereEyes(frame, Math.abs(radius));
	return {
		size,
		body: paths(isCutout ? bodyWithHoles(radii, eyes) : [fullEllipse(radii, 1)]),
		eyes: isCutout ? "" : paths(eyes),
	};
}

/** The blob as point outlines for blending with other bodies. */
export function sphereOutlines(frame: Frame, size: number) {
	const scale = (frame.zoom * size) / 2;
	const [sx, sy] = frame.squash;
	const centre: Vec2 = [
		size / 2 + scale * frame.offset[0],
		size / 2 - scale * (frame.squashAnchor * (1 - sy) + frame.offset[1]),
	];
	const radius = Math.abs(scale);
	const toScreen = ([x, y]: Vec2): Vec2 => [centre[0] + x * scale, centre[1] - y * scale];
	return {
		center: centre,
		radius,
		body: [ellipseRing(centre, [Math.abs(sx) * radius, Math.abs(sy) * radius], OUTLINE_POINTS)],
		eyes: sphereEyes(frame, radius).map((loop) => segmentPoints(loop).map(toScreen)),
	};
}

function ellipseRing(centre: Vec2, radii: Vec2, count: number): Vec2[] {
	const [rx, ry] = radii;
	return Array.from({ length: count }, (_, i) => {
		const angle = (i / count) * (Math.PI * 2);
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const r = rx === 0 || ry === 0 ? 0 : 1 / Math.hypot(cos / rx, sin / ry);
		return [centre[0] + cos * r, centre[1] + sin * r];
	});
}

function segmentPoints(segments: Segment[]): Vec2[] {
	const points: Vec2[] = [];
	let at = segments[segments.length - 1]?.to ?? [0, 0];
	for (const s of segments) {
		if (s.kind === "arc") {
			const start = Math.atan2(at[1], at[0]);
			const steps = Math.max(1, Math.ceil(Math.abs(s.sweep) / ARC_STEP));
			for (let i = 1; i < steps; i++) points.push(ellipsePoint(s.radii, start + (s.sweep * i) / steps));
		}
		points.push(s.to);
		at = s.to;
	}
	return points;
}
