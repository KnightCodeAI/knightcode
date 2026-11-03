// Draws a frame as SVG: the blob, a shaped body, or a blend of bodies with a morph overlay on top.
import { bodyModel, eyeLoops, seatedEyes, type Rotation, type ShapedBody, silhouette } from "./bodies.ts";
import type { Eye } from "./face.ts";
import { fmt, matrixToEuler, type Mat3, quatToMatrix, type Quat, type Vec2 } from "./math.ts";
import { BASE_ZOOM, type Body, type Frame } from "./motion.ts";
import { MARK_PIVOT, type Overlay, type OverlayPart, overlayFor } from "./morphs.ts";
import { CENTRE } from "./outlines.ts";
import { spherePaths, sphereOutlines } from "./sphere.ts";
import { el, type SvgNode, serialize, svgRoot } from "./svg.ts";
import { polygonsPath, unionPath } from "./union.ts";

const L = CENTRE;

/** How the avatar is painted: the body colour, and the eye colour (eyes are cut out when absent). */
export interface Appearance {
	ink: string;
	eye?: string;
}

export interface RenderOptions {
	/** The CSS size the SVG is shown at; small sizes tone down overlay zoom. */
	displaySize?: number;
	/** The SVG's width and height attribute. */
	extent?: string | number;
	/** A separate, eye-free selection ring that follows the animated silhouette. */
	hasOutline?: boolean;
}

/** The canvas is this much bigger than the avatar so motion is not clipped. */
export const canvasScale = (fill: number): number => fill / BASE_ZOOM;

// ─── Shaped bodies ──────────────────────────────────────────────────────────

const MIN_SPRITE = 144;
const BODY_SHARE = 184 / 256;
const TO_DEGREES = 180 / Math.PI;
const SILHOUETTE_BUDGET = 16e6;
const ROTATION_PRECISION = 0.6;
const EYE_CACHE_LIMIT = 256;

const silhouettes = new Map<string, string[]>();
let silhouetteCost = 0;
const eyePaths = new Map<string, string[]>();

/** Rotation in degrees from a rotation matrix, snapped to `step` and kept off exact side views. */
function rotationOf(matrix: Mat3, step: number): Rotation {
	const [x, y, z] = matrixToEuler(matrix);
	const snap = (degrees: number) => (step > 0 ? Math.round(degrees / step) * step : degrees);
	return { yaw: offEdge(snap(y * TO_DEGREES)), pitch: offEdge(snap(x * TO_DEGREES)), roll: snap(z * TO_DEGREES) };
}

/** The rotation of a frame, flipped to face forward and snapped finer as the avatar grows. */
function frameRotation(quat: Quat, size: number, zoom: number): Rotation {
	const step = 2 ** Math.floor(Math.log2((ROTATION_PRECISION / Math.max((size * zoom) / 2, 1)) * TO_DEGREES));
	const m = quatToMatrix(quat);
	return rotationOf(m[8]! >= 0 ? m : [-m[0]!, m[1]!, -m[2]!, -m[3]!, m[4]!, -m[5]!, -m[6]!, m[7]!, -m[8]!], step);
}

/** Nudges angles within half a degree of a side view off it, where the silhouette degenerates. */
function offEdge(degrees: number): number {
	const t = ((degrees % 180) + 180) % 180;
	return Math.abs(t - 90) >= 0.5 ? degrees : degrees + (t <= 90 ? 89.5 - t : 90.5 - t);
}

function bodyPaths(body: ShapedBody, rotation: Rotation, sprite: number): string[] {
	const model = bodyModel(body);
	const period = model.silhouette.kind === "solid" ? model.silhouette.yawPeriod : null;
	const { pitch, roll } = rotation;
	const yaw = period == null ? rotation.yaw : rotation.yaw - period * Math.floor(rotation.yaw / period);
	const key = `${body} ${sprite} ${yaw} ${pitch} ${roll}`;
	const cached = silhouettes.get(key);
	if (cached != null) {
		silhouettes.delete(key);
		silhouettes.set(key, cached);
		return cached;
	}
	const polygons = silhouette(model, { yaw, pitch, roll }, sprite);
	let paths: string[];
	if (polygons.length === 1) paths = [polygonsPath(polygons)];
	else {
		const union = unionPath(polygons);
		paths = union === "" ? [] : [union];
	}
	silhouettes.set(key, paths);
	silhouetteCost += cost(paths);
	for (const [k, v] of silhouettes) {
		if (silhouetteCost <= SILHOUETTE_BUDGET) break;
		silhouettes.delete(k);
		silhouetteCost -= cost(v);
	}
	return paths;
}

const cost = (paths: string[]): number => paths.reduce((sum, d) => sum + d.length, 0);

function bodyEyePaths(body: ShapedBody, rotation: Rotation, sprite: number, eyes: readonly [Eye, Eye]): string[] {
	const key = `${body} ${sprite} ${rotation.yaw} ${rotation.pitch} ${rotation.roll} ${JSON.stringify(eyes)}`;
	const cached = eyePaths.get(key);
	if (cached != null) {
		eyePaths.delete(key);
		eyePaths.set(key, cached);
		return cached;
	}
	const paths = seatedEyes(bodyModel(body), rotation, sprite, eyeLoops(body, eyes)).map((loop) => polygonsPath([loop]));
	eyePaths.set(key, paths);
	if (eyePaths.size > EYE_CACHE_LIMIT)
		for (const k of eyePaths.keys()) {
			eyePaths.delete(k);
			break;
		}
	return paths;
}

/** Where the sprite lands: scale x, scale y, then translation, as a matrix's a, d, e, f. */
function spritePlacement(frame: Frame, size: number, pixels: number, sprite: number): [number, number, number, number] {
	const half = size / 2;
	const x = half + frame.offset[0] * frame.zoom * half;
	const y = half - frame.offset[1] * frame.zoom * half;
	const anchor = y - frame.squashAnchor * frame.zoom * half;
	const [sx, sy] = frame.squash;
	const scale = pixels / sprite;
	return [sx * scale, sy * scale, x - (sx * pixels) / 2, anchor + sy * (y - pixels / 2 - anchor)];
}

const fmt6 = (value: number): number => Math.round(value * 1e6) / 1e6;

interface ShapeDrawing {
	size: number;
	sprite: number;
	transform: string;
	body: string[];
	eyes: string[];
}

function drawShape(frame: Frame, body: ShapedBody, size: number): ShapeDrawing {
	const pixels = Math.max(8, Math.round((size * frame.zoom) / BODY_SHARE));
	const sprite = Math.max(pixels, MIN_SPRITE);
	const rotation = frameRotation(frame.quat, size, frame.zoom);
	const [a, d, e, f] = spritePlacement(frame, size, pixels, sprite);
	return {
		size,
		sprite,
		transform: `matrix(${fmt6(a)} 0 0 ${fmt6(d)} ${fmt6(e)} ${fmt6(f)})`,
		body: bodyPaths(body, rotation, sprite),
		eyes: frame.eyes == null ? [] : bodyEyePaths(body, rotation, sprite, frame.eyes),
	};
}

function shapeSvg(
	drawing: ShapeDrawing,
	appearance: Appearance,
	id: string,
	extent: string | number = drawing.size,
): SvgNode {
	const sprite = drawing.sprite;
	const bodyId = `${id}-body`;
	const area = { maskUnits: "userSpaceOnUse", x: 0, y: 0, width: sprite, height: sprite };
	const eyes = (fill: string) => drawing.eyes.map((d) => el("path", { d, fill }));
	const defs = [
		el(
			"g",
			{ id: bodyId },
			drawing.body.map((d) => el("path", { d })),
		),
	];
	let mask = {};
	const painted: SvgNode[] = [];
	if (drawing.eyes.length > 0 && appearance.eye == null) {
		defs.push(
			el("mask", { id: `${id}-holes`, ...area }, [
				el("rect", { width: sprite, height: sprite, fill: "#fff" }),
				...eyes("#000"),
			]),
		);
		mask = { mask: `url(#${id}-holes)` };
	} else if (drawing.eyes.length > 0 && appearance.eye != null) {
		defs.push(el("mask", { id: `${id}-inside`, ...area }, [el("use", { href: `#${bodyId}`, fill: "#fff" })]));
		painted.push(el("g", { mask: `url(#${id}-inside)` }, eyes(appearance.eye)));
	}
	return svgRoot(drawing.size, id, extent, [
		el("defs", {}, defs),
		el("g", { transform: drawing.transform }, [
			el("use", { href: `#${bodyId}`, fill: appearance.ink, ...mask }),
			...painted,
		]),
	]);
}

function sphereSvg(
	frame: Frame,
	appearance: Appearance,
	size: number,
	id: string,
	extent: string | number = size,
): SvgNode {
	const paths = spherePaths(frame, size, appearance.eye == null);
	const children = [el("path", { d: paths.body, fill: appearance.ink, "fill-rule": "evenodd" })];
	if (paths.eyes !== "") children.push(el("path", { d: paths.eyes, fill: appearance.eye! }));
	return svgRoot(paths.size, id, extent, children);
}

// ─── Blends ─────────────────────────────────────────────────────────────────
// While bodies cross-fade or a morph overlay shows, every body is resampled as a radial outline around its centre
// so the outlines can be averaged point by point.

const TAU = Math.PI * 2;
const ANGLE_EPSILON = 1e-7;
const STATION_EPSILON = 1e-7;
const ANGLE_BUCKETS = 720;
const BASE_ANGLES = Array.from({ length: 192 }, (_, i) => (i / 192) * TAU);
const BASE_STATIONS = Array.from({ length: 96 }, (_, i) => i / 96);
/** Eyes nearer than this share of the radius are treated as the same eye across bodies. */
const EYE_MATCH = 0.6;

interface Outlines {
	center: Vec2;
	radius: number;
	body: Vec2[][];
	eyes: Vec2[][];
}

const angleAround = (centre: Vec2, x: number, y: number): number => {
	const angle = Math.atan2(y - centre[1], x - centre[0]);
	return angle < 0 ? angle + TAU : angle;
};

function uniqueSorted(lists: number[][], epsilon: number): number[] {
	const all = lists.flat().sort((a, b) => a - b);
	return all.filter((v, i) => i === 0 || v - all[i - 1]! > epsilon);
}

/** Each body edge filed under every angle bucket it spans, for ray casts. */
function edgeBuckets(loops: Vec2[][], centre: Vec2): [Vec2, Vec2][][] {
	const buckets: [Vec2, Vec2][][] = Array.from({ length: ANGLE_BUCKETS }, () => []);
	for (const loop of loops)
		for (let i = 0; i < loop.length; i++) {
			const a = loop[i]!;
			const b = loop[(i + 1) % loop.length]!;
			const start = angleAround(centre, a[0], a[1]);
			let span = angleAround(centre, b[0], b[1]) - start;
			if (span > Math.PI) span -= TAU;
			if (span < -Math.PI) span += TAU;
			const first = Math.floor(((span < 0 ? start + span : start) / TAU) * ANGLE_BUCKETS) - 1;
			const last = Math.floor(((span < 0 ? start : start + span) / TAU) * ANGLE_BUCKETS) + 1;
			for (let k = first; k <= last; k++) buckets[((k % ANGLE_BUCKETS) + ANGLE_BUCKETS) % ANGLE_BUCKETS]!.push([a, b]);
		}
	return buckets;
}

function farthestHit(buckets: [Vec2, Vec2][][], [cx, cy]: Vec2, angle: number): number {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	let best = NaN;
	for (const [[ax, ay], [bx, by]] of buckets[Math.floor((angle / TAU) * ANGLE_BUCKETS) % ANGLE_BUCKETS]!) {
		const ex = bx - ax;
		const ey = by - ay;
		const det = cos * ey - sin * ex;
		if (Math.abs(det) < 1e-12) continue;
		const px = ax - cx;
		const py = ay - cy;
		const t = (px * ey - py * ex) / det;
		const u = (px * sin - py * cos) / det;
		if (t >= 0 && u >= -1e-9 && u <= 1.000000001 && !(t <= best)) best = t;
	}
	return best;
}

/** Fills rays that missed with values interpolated from their neighbours around the circle. */
function fillGaps(values: number[]): number[] {
	const count = values.length;
	const known = values.flatMap((v, i) => (Number.isNaN(v) ? [] : [i]));
	return known.length === 0
		? values.map(() => 0)
		: values.map((v, i) => {
				if (!Number.isNaN(v)) return v;
				const after = known.find((k) => k > i) ?? known[0]! + count;
				const before = [...known].reverse().find((k) => k < i) ?? (known.at(-1) ?? 0) - count;
				const t = (i - before) / (after - before);
				return values[(before + count) % count]! * (1 - t) + values[after % count]! * t;
			});
}

function radialOutline(loops: Vec2[][], centre: Vec2, angles: number[]): Vec2[] {
	const buckets = edgeBuckets(loops, centre);
	const reach = fillGaps(angles.map((a) => farthestHit(buckets, centre, a)));
	return angles.map((a, i) => [centre[0] + Math.cos(a) * reach[i]!, centre[1] + Math.sin(a) * reach[i]!]);
}

/** Resamples a ring of points by angle around `centre`. */
function byAngle(points: Vec2[], centre: Vec2, angles: number[]): Vec2[] {
	const polar = points
		.map(([x, y]) => ({ angle: angleAround(centre, x, y), reach: Math.hypot(x - centre[0], y - centre[1]) }))
		.sort((a, b) => a.angle - b.angle);
	return angles.map((angle) => {
		const reach = reachAt(polar, angle);
		return [centre[0] + Math.cos(angle) * reach, centre[1] + Math.sin(angle) * reach];
	});
}

function reachAt(polar: { angle: number; reach: number }[], angle: number): number {
	const count = polar.length;
	if (count === 0) return 0;
	let i = polar.findIndex((p) => p.angle >= angle);
	if (i < 0) i = 0;
	const after = polar[i]!;
	const before = polar[(i - 1 + count) % count]!;
	const gap = (after.angle - before.angle + TAU) % TAU;
	if (gap === 0) return after.reach;
	const t = ((angle - before.angle + TAU) % TAU) / gap;
	return before.reach + (after.reach - before.reach) * t;
}

function polygonArea(points: Vec2[]): number {
	let sum = 0;
	for (let i = 0; i < points.length; i++) {
		const [ax, ay] = points[i]!;
		const [bx, by] = points[(i + 1) % points.length]!;
		sum += ax * by - bx * ay;
	}
	return sum / 2;
}

const centroid = (points: Vec2[]): Vec2 => {
	if (points.length === 0) return [0, 0];
	let x = 0;
	let y = 0;
	for (const [px, py] of points) {
		x += px;
		y += py;
	}
	return [x / points.length, y / points.length];
};

/** Where a rightward ray from `point` last crosses the loop, to start the loop there. */
function rightmostCrossing(points: Vec2[], [px, py]: Vec2): { edge: number; point: Vec2 } | null {
	let best: { edge: number; point: Vec2 } | null = null;
	for (let i = 0; i < points.length; i++) {
		const [ax, ay] = points[i]!;
		const [bx, by] = points[(i + 1) % points.length]!;
		if (ay === by || (ay - py) * (by - py) > 0) continue;
		const x = ax + ((py - ay) / (by - ay)) * (bx - ax);
		if (x >= px && (best == null || x > best.point[0])) best = { edge: i, point: [x, py] };
	}
	return best;
}

/** A loop made counter-clockwise, started at a stable point, with each point's share of the perimeter. */
function withStations(loop: Vec2[]) {
	const ordered = polygonArea(loop) < 0 ? [...loop].reverse() : loop;
	const start = rightmostCrossing(ordered, centroid(ordered));
	const points =
		start == null ? ordered : [start.point, ...ordered.slice(start.edge + 1), ...ordered.slice(0, start.edge + 1)];
	const lengths = [0];
	for (let i = 0; i < points.length; i++) {
		const [ax, ay] = points[i]!;
		const [bx, by] = points[(i + 1) % points.length]!;
		lengths.push(lengths[i]! + Math.hypot(bx - ax, by - ay));
	}
	const total = lengths[points.length] ?? 0;
	return { points, stations: lengths.map((l) => (total === 0 ? 0 : l / total)) };
}

function atStations({ points, stations }: { points: Vec2[]; stations: number[] }, at: number[]): Vec2[] {
	if (points.length === 0) return [];
	let i = 0;
	return at.map((s) => {
		while (i < points.length - 1 && stations[i + 1]! < s) i++;
		const [ax, ay] = points[i]!;
		const [bx, by] = points[(i + 1) % points.length]!;
		const span = stations[i + 1]! - stations[i]!;
		const t = span === 0 ? 0 : (s - stations[i]!) / span;
		return [ax + (bx - ax) * t, ay + (by - ay) * t];
	});
}

function weightedAverage(items: { outline: Vec2[]; weight: number }[]): Vec2[] {
	const total = items.reduce((sum, item) => sum + item.weight, 0);
	const [first] = items;
	return first == null || total === 0
		? []
		: first.outline.map((_, i) => {
				let x = 0;
				let y = 0;
				for (const { outline, weight } of items) {
					x += outline[i]![0] * weight;
					y += outline[i]![1] * weight;
				}
				return [x / total, y / total];
			});
}

const lerpOutline = (a: Vec2[], b: Vec2[], t: number): Vec2[] =>
	a.map(([x, y], i) => [x + (b[i]![0] - x) * t, y + (b[i]![1] - y) * t]);

const outlinePath = (points: Vec2[]): string =>
	points.length === 0 ? "" : `M${points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z`;

/** Shaped-body outlines as point loops in screen space. */
function shapeOutlines(frame: Frame, body: ShapedBody, size: number): Outlines {
	const pixels = Math.max(8, Math.round((size * frame.zoom) / BODY_SHARE));
	const sprite = Math.max(pixels, MIN_SPRITE);
	const rotation = frameRotation(frame.quat, size, frame.zoom);
	const paths = bodyPaths(body, rotation, sprite);
	const eyes = frame.eyes == null ? [] : bodyEyePaths(body, rotation, sprite, frame.eyes);
	const [a, d, e, f] = spritePlacement(frame, size, pixels, sprite);
	const place = ([x, y]: Vec2): Vec2 => [a * x + e, d * y + f];
	const loops = (path: string) => parsePolygons(path).map((loop) => loop.map(place));
	return {
		center: [(a * sprite) / 2 + e, (d * sprite) / 2 + f],
		radius: (frame.zoom * size) / 2,
		body: paths.flatMap(loops),
		eyes: frame.eyes == null ? [] : eyes.flatMap(loops),
	};
}

/** Reads back the "M x y x y ...Z" polygons this renderer writes. */
function parsePolygons(d: string): Vec2[][] {
	const loops: Vec2[][] = [];
	for (const part of d.split("Z")) {
		const numbers = part
			.replace("M", " ")
			.trim()
			.split(/\s+/)
			.filter((s) => s !== "")
			.map(Number);
		if (numbers.length < 6) continue;
		const loop: Vec2[] = [];
		for (let i = 0; i + 1 < numbers.length; i += 2) loop.push([numbers[i]!, numbers[i + 1]!]);
		loops.push(loop);
	}
	return loops;
}

const outlinesFor = (frame: Frame, body: Body, size: number): Outlines =>
	body === "sphere" ? sphereOutlines({ ...frame, body }, size) : shapeOutlines({ ...frame, body }, body, size);

/** Pairs each body's eyes by position, then blends each pair's outlines. */
function blendEyes(shapes: { shape: Outlines; weight: number }[]): Vec2[][] {
	const reach = (shapes[0]?.shape.radius ?? 0) * EYE_MATCH;
	const groups: { anchor: Vec2; loops: (Vec2[] | null)[] }[] = [];
	shapes.forEach(({ shape }, index) => {
		for (const loop of shape.eyes) {
			const anchor = centroid(loop);
			const match = nearestGroup(groups, index, anchor, reach);
			if (match != null) {
				match.loops[index] = loop;
				continue;
			}
			const loops: (Vec2[] | null)[] = shapes.map(() => null);
			loops[index] = loop;
			groups.push({ anchor, loops });
		}
	});
	return groups.map((group) => {
		const stationed = group.loops.map((loop) => (loop == null ? null : withStations(loop)));
		const at = uniqueSorted(
			[BASE_STATIONS, ...stationed.map((s) => (s?.stations ?? []).filter((v) => v < 1))],
			STATION_EPSILON,
		);
		return weightedAverage(
			shapes.map(({ weight }, i) => {
				const s = stationed[i];
				return {
					outline:
						s == null
							? Array.from({ length: at.length }, () => [group.anchor[0], group.anchor[1]] as Vec2)
							: atStations(s, at),
					weight,
				};
			}),
		);
	});
}

function nearestGroup(
	groups: { anchor: Vec2; loops: (Vec2[] | null)[] }[],
	index: number,
	anchor: Vec2,
	reach: number,
) {
	let best: (typeof groups)[number] | null = null;
	let distance = reach;
	for (const group of groups) {
		if (group.loops[index] != null) continue;
		const d = Math.hypot(group.anchor[0] - anchor[0], group.anchor[1] - anchor[1]);
		if (d < distance) {
			best = group;
			distance = d;
		}
	}
	return best;
}

interface Head {
	translate: Vec2;
	rotation: number;
	scale: number;
	opacity: number;
}

interface Blend {
	size: number;
	center: Vec2;
	body: Vec2[];
	eyes: Vec2[][];
	head: Head | null;
	parts: OverlayPart[];
	markScale: number;
	zoom: number;
}

function blendFrame(frame: Frame, size: number, displaySize: number): Blend {
	const shapes = frame.bodies
		.map(({ body, weight }) => ({ shape: outlinesFor(frame, body, size), weight }))
		.sort((a, b) => b.weight - a.weight);
	const center = shapes[0]?.shape.center ?? [size / 2, size / 2];
	const radius = shapes[0]?.shape.radius ?? 0;
	const angles = uniqueSorted(
		[
			BASE_ANGLES,
			...shapes.map(({ shape }) => shape.body.flatMap((loop) => loop.map(([x, y]) => angleAround(shape.center, x, y)))),
		],
		ANGLE_EPSILON,
	);
	const body = weightedAverage(
		shapes.map(({ shape, weight }) => ({ outline: radialOutline(shape.body, shape.center, angles), weight })),
	);
	const overlay = frame.morph == null ? null : overlayFor(frame.morph, displaySize);
	const markScale = (BASE_ZOOM * size) / 2 / L;
	const round = overlay?.core.round ?? 0;
	return {
		size,
		center,
		body:
			overlay == null || round === 0 ? body : lerpOutline(body, coreOutline(overlay, center, radius, angles), round),
		eyes: shapes.length === 1 ? (shapes[0]?.shape.eyes ?? []) : blendEyes(shapes),
		head: overlay == null || frame.morph == null ? null : headOf(overlay, frame.morph.amount, frame.zoom, markScale),
		parts: overlay?.parts ?? [],
		markScale,
		zoom: overlay?.zoom ?? 1,
	};
}

function coreOutline(overlay: Overlay, center: Vec2, radius: number, angles: number[]): Vec2[] {
	const scale = radius / L;
	return byAngle(
		overlay.core.ring.map(([x, y]) => [center[0] + (x - L) * scale, center[1] + (y - L) * scale]),
		center,
		angles,
	);
}

function headOf(overlay: Overlay, amount: number, zoom: number, markScale: number): Head {
	const { core } = overlay;
	const rest = 1 - amount;
	const shrink = amount > 0 ? (core.scale - rest) / amount : 0;
	return {
		translate: [core.dx * markScale, core.dy * markScale],
		rotation: core.rotation,
		scale: rest + (BASE_ZOOM / zoom) * shrink * amount,
		opacity: core.opacity,
	};
}

function partSvg(part: OverlayPart, fill: string): SvgNode {
	const opacity: Record<string, string> = part.opacity < 1 ? { opacity: fmt(part.opacity, 3) } : {};
	switch (part.type) {
		case "disc":
			return el("circle", { cx: fmt(part.cx), cy: fmt(part.cy), r: fmt(part.r), fill, ...opacity });
		case "ring": {
			const circumference = 2 * Math.PI * part.r;
			const arc: Record<string, string> =
				part.arc == null
					? {}
					: {
							"stroke-dasharray": `${fmt(circumference * part.arc.fraction)} ${fmt(circumference)}`,
							transform: `rotate(${fmt(part.arc.startDeg)} ${fmt(part.cx)} ${fmt(part.cy)})`,
						};
			return el("circle", {
				cx: fmt(part.cx),
				cy: fmt(part.cy),
				r: fmt(part.r),
				fill: "none",
				stroke: fill,
				"stroke-width": fmt(part.width),
				...arc,
				...opacity,
			});
		}
		case "shape":
			return el("path", { d: part.d, transform: part.transform, fill, ...opacity });
		case "stroke":
			return el("path", {
				d: part.d,
				fill: "none",
				stroke: fill,
				"stroke-width": fmt(part.width),
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
				...opacity,
			});
	}
}

function blendSvg(blend: Blend, appearance: Appearance, id: string, extent: string | number = blend.size): SvgNode {
	const { size, center } = blend;
	const ink = appearance.ink;
	const bodyPath = outlinePath(blend.body);
	const eyePath = blend.eyes.map(outlinePath).join("");
	const defs: SvgNode[] = [];
	const content: SvgNode[] = [el("path", { d: bodyPath, fill: ink })];
	if (eyePath !== "" && appearance.eye == null) {
		defs.push(
			el("mask", { id: `${id}-holes`, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: size, height: size }, [
				el("rect", { width: size, height: size, fill: "#fff" }),
				el("path", { d: eyePath, fill: "#000" }),
			]),
		);
		content[0] = el("path", { d: bodyPath, fill: ink, mask: `url(#${id}-holes)` });
	} else if (eyePath !== "") {
		defs.push(el("clipPath", { id: `${id}-body` }, [el("path", { d: bodyPath })]));
		content.push(el("path", { d: eyePath, fill: appearance.eye!, "clip-path": `url(#${id}-body)` }));
	}
	const head = blend.head;
	const placed =
		head == null
			? content
			: [
					el(
						"g",
						{
							transform: `translate(${fmt(center[0] + head.translate[0])} ${fmt(center[1] + head.translate[1])}) rotate(${fmt(head.rotation)}) scale(${fmt(head.scale, 5)}) translate(${fmt(-center[0])} ${fmt(-center[1])})`,
							...(head.opacity < 1 ? { opacity: fmt(head.opacity, 3) } : {}),
						},
						content,
					),
				];
	const parts =
		blend.parts.length === 0
			? []
			: [
					el(
						"g",
						{
							transform: `translate(${size / 2} ${size / 2}) scale(${fmt(blend.markScale, 5)}) translate(${-L} ${-L})`,
						},
						blend.parts.map((p) => partSvg(p, ink)),
					),
				];
	const pivot = size / 2 + (MARK_PIVOT - L) * blend.markScale;
	const all =
		blend.zoom === 1
			? [...parts, ...placed]
			: [
					el(
						"g",
						{
							transform: `translate(${fmt(pivot)} ${fmt(pivot)}) scale(${fmt(blend.zoom, 5)}) translate(${fmt(-pivot)} ${fmt(-pivot)})`,
						},
						[...parts, ...placed],
					),
				];
	return svgRoot(size, id, extent, [...(defs.length === 0 ? [] : [el("defs", {}, defs)]), ...all]);
}

// ─── Entry points ───────────────────────────────────────────────────────────

/** A frame as an SVG tree in a `size` pixel square with element ids prefixed by `id`. */
export function renderTree(
	frame: Frame,
	appearance: Appearance,
	size: number,
	id: string,
	options: RenderOptions = {},
): SvgNode {
	const tree = drawTree(frame, appearance, size, id, options);
	if (!options.hasOutline) return tree;
	// Reuse the same frame and transforms, but omit eyes so only the outer silhouette gets a ring.
	const silhouette = drawTree({ ...frame, eyes: null }, { ink: "#fff" }, size, `${id}-outline`, options);
	const silhouetteId = `${id}-outline-silhouette`;
	const gapId = `${id}-outline-gap`;
	tree.children.unshift(
		el("defs", {}, [
			el("g", { id: silhouetteId }, silhouette.children.map(outlineGeometry)),
			el("mask", { id: gapId, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: size, height: size }, [
				el("rect", { width: size, height: size, fill: "#fff" }),
				el("use", { href: `#${silhouetteId}`, fill: "#000", stroke: "#000", "stroke-width": 5 }),
			]),
		]),
		el(
			"g",
			{ "data-avatar-outline": "", fill: "none", stroke: "currentColor", "stroke-width": 8, mask: `url(#${gapId})` },
			[el("use", { href: `#${silhouetteId}` })],
		),
	);
	return tree;
}

/** Paint is inherited from each use; non-scaling strokes keep the gap uniform through body transforms. */
function outlineGeometry(node: SvgNode): SvgNode {
	const attrs = { ...node.attrs };
	if (node.tag === "path" || node.tag === "use" || node.tag === "circle") {
		attrs.fill = "inherit";
		attrs.stroke = "inherit";
		attrs["stroke-width"] = "inherit";
		attrs["stroke-linejoin"] = "round";
		attrs["stroke-linecap"] = "round";
		attrs["vector-effect"] = "non-scaling-stroke";
	}
	return { tag: node.tag, attrs, children: node.children.map(outlineGeometry) };
}

function drawTree(frame: Frame, appearance: Appearance, size: number, id: string, options: RenderOptions): SvgNode {
	const [only, ...rest] = frame.bodies;
	if (only == null || rest.length > 0 || frame.morph != null)
		return blendSvg(blendFrame(frame, size, options.displaySize ?? size), appearance, id, options.extent);
	if (only.body === "sphere") return sphereSvg({ ...frame, body: only.body }, appearance, size, id, options.extent);
	return shapeSvg(drawShape({ ...frame, body: only.body }, only.body, size), appearance, id, options.extent);
}

export const renderSvg = (
	frame: Frame,
	appearance: Appearance,
	size: number,
	id: string,
	options: RenderOptions = {},
): string => serialize(renderTree(frame, appearance, size, id, options));
