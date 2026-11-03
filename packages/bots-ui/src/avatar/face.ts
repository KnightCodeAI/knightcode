// The face: eye shapes, the expressions built from them, and the controller that blinks and morphs between them.
import {
	type Curve,
	cubicBezier,
	EASE_FACE_MORPH,
	EYE_HALF_WIDTH,
	lerp,
	lerp2,
	smoothstep01,
	type Vec2,
} from "./math.ts";

/** One eye in face space: a thick stroke along `pts` (or an oval), placed at `off` and turned by `tilt`. */
export interface Eye {
	off: Vec2;
	tilt: number;
	/** Half the stroke width. */
	wid: number;
	/** Vertical lid scale: 1 open, toward 0 closed. */
	lidY: number;
	/** Oval radii; [0, 0] when the eye is a stroke. */
	oval: Vec2;
	/** How far a morph has turned the stroke into the oval. */
	ovalMix: number;
	/** The stroke's spine. */
	pts: Vec2[];
	/** The spine as two cubic segments: three nodes of [x, y, inX, inY, outX, outY]. */
	path: number[] | null;
	/** An explicit outline while morphing toward an oval. */
	fillRing: Vec2[] | null;
}

export type EyePair = [Eye, Eye];

export const EXPRESSIONS = [
	"neutral",
	"happy",
	"surprised",
	"sad",
	"sleepy",
	"squinted",
	"calm",
	"inspecting",
	"confused",
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

const EYE_WIDTH = 0.26;
const PATH_LENGTH = 18;

/** Other names motion clips use for expressions. */
const EXPRESSION_ALIASES = new Map<string, Expression>([
	["thinking", "sad"],
	["strange", "inspecting"],
	["angry", "neutral"],
	["inspect", "inspecting"],
	["squint", "squinted"],
	["idle", "neutral"],
	["smile", "happy"],
	["sleep", "sleepy"],
]);

/** Expressions whose eyes are already lid-like, so a blink cannot pass through them. */
const LIDDED = new Set<Expression>(["sad", "happy", "confused", "squinted", "sleepy"]);

function nodePoint(path: number[], node: number): Vec2 {
	return [path[node * 6]!, path[node * 6 + 1]!];
}

function handlePoint(path: number[], node: number, isOut: boolean): Vec2 {
	const offset = isOut ? 4 : 2;
	return [path[node * 6]! + path[node * 6 + offset]!, path[node * 6 + 1]! + path[node * 6 + offset + 1]!];
}

/** Samples the two cubic segments of an eye path at 21 points. */
function samplePath(path: number[]): Vec2[] {
	const points: Vec2[] = [];
	const segment = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, first: number) => {
		for (let i = first; i < 11; i++) {
			const t = i / 10;
			const u = 1 - t;
			const a = u * u * u;
			const b = 3 * u * u * t;
			const c = 3 * u * t * t;
			const d = t * t * t;
			points.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
		}
	};
	segment(nodePoint(path, 0), handlePoint(path, 0, true), handlePoint(path, 1, false), nodePoint(path, 1), 0);
	segment(nodePoint(path, 1), handlePoint(path, 1, true), handlePoint(path, 2, false), nodePoint(path, 2), 1);
	return points;
}

interface SpineSpec {
	p0: Vec2;
	p1: Vec2;
	p2: Vec2;
	/** Bend through `p1` as a circular arc, rather than using it as a control point. */
	isArc: boolean;
}

function buildPath({ p0, p1, p2, isArc }: SpineSpec): number[] {
	const [x0, y0] = p0;
	const [x1, y1] = p1;
	const [x2, y2] = p2;
	const path: number[] = Array(PATH_LENGTH).fill(0);
	const setPoint = (node: number, point: Vec2) => {
		path[node * 6] = point[0];
		path[node * 6 + 1] = point[1];
	};
	const setIn = (node: number, point: Vec2) => {
		path[node * 6 + 2] = point[0] - path[node * 6]!;
		path[node * 6 + 3] = point[1] - path[node * 6 + 1]!;
	};
	const setOut = (node: number, point: Vec2) => {
		path[node * 6 + 4] = point[0] - path[node * 6]!;
		path[node * 6 + 5] = point[1] - path[node * 6 + 1]!;
	};
	if (isArc) {
		const det = 2 * (x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1));
		if (Math.abs(det) > 1e-9) {
			const s0 = x0 * x0 + y0 * y0;
			const s1 = x1 * x1 + y1 * y1;
			const s2 = x2 * x2 + y2 * y2;
			const cx = (s0 * (y1 - y2) + s1 * (y2 - y0) + s2 * (y0 - y1)) / det;
			const cy = (s0 * (x2 - x1) + s1 * (x0 - x2) + s2 * (x1 - x0)) / det;
			const radius = Math.hypot(x0 - cx, y0 - cy);
			const start = Math.atan2(y0 - cy, x0 - cx);
			const end = Math.atan2(y2 - cy, x2 - cx);
			const through = Math.atan2(y1 - cy, x1 - cx);
			const full = Math.PI * 2;
			const forward = (end - start + full) % full;
			const sweep = (through - start + full) % full <= forward ? forward : forward - full;
			const at = (angle: number): Vec2 => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
			const tangent = (angle: number): Vec2 => [-Math.sin(angle), Math.cos(angle)];
			const half = sweep / 2;
			const handle = (4 / 3) * Math.tan(half / 4) * radius;
			const angles = [start, start + half, start + sweep];
			for (let node = 0; node < 3; node++) {
				const point = at(angles[node]!);
				const direction = tangent(angles[node]!);
				setPoint(node, point);
				if (node > 0) setIn(node, [point[0] - handle * direction[0], point[1] - handle * direction[1]]);
				if (node < 2) setOut(node, [point[0] + handle * direction[0], point[1] + handle * direction[1]]);
			}
			return path;
		}
		const middle: Vec2 = [(x0 + x2) / 2, (y0 + y2) / 2];
		setPoint(0, [x0, y0]);
		setPoint(1, middle);
		setPoint(2, [x2, y2]);
		setOut(0, [x0 + (middle[0] - x0) / 3, y0 + (middle[1] - y0) / 3]);
		setIn(1, [middle[0] - (middle[0] - x0) / 3, middle[1] - (middle[1] - y0) / 3]);
		setOut(1, [middle[0] + (x2 - middle[0]) / 3, middle[1] + (y2 - middle[1]) / 3]);
		setIn(2, [x2 - (x2 - middle[0]) / 3, y2 - (y2 - middle[1]) / 3]);
		return path;
	}
	const m: Vec2 = [(x0 + x1) / 2, (y0 + y1) / 2];
	const h: Vec2 = [(x1 + x2) / 2, (y1 + y2) / 2];
	const g: Vec2 = [(m[0] + h[0]) / 2, (m[1] + h[1]) / 2];
	setPoint(0, [x0, y0]);
	setPoint(1, g);
	setPoint(2, [x2, y2]);
	setOut(0, [x0 + (2 / 3) * (m[0] - x0), y0 + (2 / 3) * (m[1] - y0)]);
	setIn(1, [g[0] + (2 / 3) * (m[0] - g[0]), g[1] + (2 / 3) * (m[1] - g[1])]);
	setOut(1, [g[0] + (2 / 3) * (h[0] - g[0]), g[1] + (2 / 3) * (h[1] - g[1])]);
	setIn(2, [x2 + (2 / 3) * (h[0] - x2), y2 + (2 / 3) * (h[1] - y2)]);
	return path;
}

function strokeEye(off: Vec2, tilt: number, wid: number, spine: SpineSpec, oval: Vec2): Eye {
	const path = buildPath(spine);
	return { off, tilt, wid, lidY: 1, oval, ovalMix: 0, pts: samplePath(path), path, fillRing: null };
}

/** A straight capsule `width` wide and `height` tall, its long axis turned `angle` degrees. */
function capsule(width: number, height: number, angle: number, off: Vec2, tilt: number): Eye {
	const reach = Math.max(0, (height - width) / 2);
	const radians = (angle * Math.PI) / 180;
	const x = Math.sin(radians) * reach;
	const y = Math.cos(radians) * reach;
	return strokeEye(off, tilt, width / 2, { p0: [-x, -y], p1: [0, 0], p2: [x, y], isArc: false }, [0, 0]);
}

const pill = (width: number, height: number, angle: number, x: number): Eye => capsule(width, height, angle, [x, 0], 0);

function ovalEye(rx: number, ry: number, x: number): Eye {
	return strokeEye([x, 0], 0, ry, { p0: [-rx, 0], p1: [0, 0], p2: [rx, 0], isArc: false }, [rx, ry]);
}

const both = (eye: Eye): EyePair => [eye, eye];

export const FACES: Record<Expression, EyePair> = {
	neutral: both(pill(EYE_WIDTH, 0.57, 0, 0)),
	happy: both(
		strokeEye(
			[0.03, 0.03],
			0,
			EYE_HALF_WIDTH,
			{ p0: [0.16, -0.04], p1: [0, 0.12], p2: [-0.16, -0.04], isArc: true },
			[0, 0],
		),
	),
	surprised: both(pill(0.42, 0.86, 0, 0.03)),
	inspecting: [pill(0.54, 0.54, 0, 0.04), pill(0.36, 0.36, 0, 0.04)],
	sad: both(pill(EYE_WIDTH, 0.5, -28, -0.05)),
	sleepy: both(
		strokeEye(
			[0.01, 0],
			0,
			EYE_WIDTH / 2,
			{ p0: [-0.11, 0.025], p1: [0, -0.05], p2: [0.11, 0.025], isArc: false },
			[0, 0],
		),
	),
	squinted: both(pill(EYE_WIDTH, 0.5, 90, 0.01)),
	calm: both(ovalEye(0.296, 0.247, 0.05)),
	confused: both(
		strokeEye(
			[-0.1, 0],
			0,
			EYE_HALF_WIDTH,
			{ p0: [0.01, 0.16], p1: [-0.17, 0], p2: [0.01, -0.16], isArc: false },
			[0, 0],
		),
	),
};

const isExpression = (name: string): name is Expression => EXPRESSIONS.some((e) => e === name);

/** Resolves a clip's expression name, falling back to neutral. */
export function toExpression(name: string): Expression {
	const key = name.trim().toLowerCase();
	const resolved = EXPRESSION_ALIASES.get(key) ?? key;
	return isExpression(resolved) ? resolved : "neutral";
}

export const isLidded = (name: Expression): boolean => LIDDED.has(name);

/** Whether clip lid keyframes may close this expression's eyes. */
export const takesLids = (name: Expression): boolean => !isLidded(name) && !FACES[name].some(isOval);

export function mapPair(pair: EyePair, fn: (eye: Eye, index: number) => Eye): EyePair {
	return [fn(pair[0], 0), fn(pair[1], 1)];
}

const settled = (eye: Eye): Eye => ({ ...eye, ovalMix: 0 });

export const isOval = (eye: Eye): boolean => eye.oval[0] > 1e-4 && eye.oval[1] > 1e-4;

/** Whether a stroke eye's spine bends away from a straight line. */
function isCurved(eye: Eye): boolean {
	if (isOval(eye) || eye.pts.length < 3) return false;
	const first = eye.pts[0]!;
	const last = eye.pts[eye.pts.length - 1]!;
	const dx = last[0] - first[0];
	const dy = last[1] - first[1];
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq < 1e-8) return false;
	let deviation = 0;
	for (const point of eye.pts) {
		const t = ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / lengthSq;
		const px = first[0] + t * dx;
		const py = first[1] + t * dy;
		const distance = Math.hypot(point[0] - px, point[1] - py);
		if (distance > deviation) deviation = distance;
	}
	return deviation > Math.max(0.012, eye.wid * 0.2);
}

const MIN_LID = 0.03;
const BLINK_SQUEEZE = 0.42;
const TURN_FOR_FULL_INSPECT = 20;

function sampleAlong(points: Vec2[], index: number, count: number): Vec2 {
	if (points.length === 0) return [0, 0];
	if (points.length === 1 || count <= 1) return points[0]!;
	const position = (index / (count - 1)) * (points.length - 1);
	const i = Math.min(Math.floor(position), points.length - 2);
	return lerp2(points[i]!, points[i + 1]!, position - i);
}

/** Blends two eyes along their spines. */
function blendSpine(from: Eye, to: Eye, t: number): Eye {
	const base = {
		off: lerp2(from.off, to.off, t),
		tilt: lerp(from.tilt, to.tilt, t),
		wid: lerp(from.wid, to.wid, t),
		lidY: lerp(from.lidY, to.lidY, t),
		oval: lerp2(from.oval, to.oval, t),
		ovalMix: 0,
		fillRing: null,
	};
	if (from.path && to.path && from.path.length === to.path.length) {
		const target = to.path;
		const path = from.path.map((value, i) => lerp(value, target[i]!, t));
		return { ...base, path, pts: samplePath(path) };
	}
	const count = Math.max(from.pts.length, to.pts.length, 2);
	const pts: Vec2[] = [];
	for (let i = 0; i < count; i++) pts.push(lerp2(sampleAlong(from.pts, i, count), sampleAlong(to.pts, i, count), t));
	return { ...base, path: null, pts };
}

interface Axis {
	cx: number;
	cy: number;
	ang: number;
	halfLen: number;
	halfW: number;
}

/** An eye reduced to a stadium: centre, angle, half length and half width. */
function axisOf(eye: Eye): Axis {
	if (isOval(eye)) {
		const [rx, ry] = eye.oval;
		return {
			cx: eye.off[0],
			cy: eye.off[1],
			ang: rx >= ry ? Math.PI / 2 : 0,
			halfLen: Math.max(rx, ry),
			halfW: Math.min(rx, ry),
		};
	}
	const width = eye.wid;
	if (eye.pts.length < 2) return { cx: eye.off[0], cy: eye.off[1], ang: eye.tilt, halfLen: width, halfW: width };
	const first = eye.pts[0]!;
	const last = eye.pts[eye.pts.length - 1]!;
	return {
		cx: eye.off[0] + (first[0] + last[0]) / 2,
		cy: eye.off[1] + (first[1] + last[1]) / 2,
		ang: Math.atan2(last[0] - first[0], last[1] - first[1]) + eye.tilt,
		halfLen: Math.hypot(last[0] - first[0], last[1] - first[1]) / 2 + width,
		halfW: width,
	};
}

/** The signed turn from `a` to `b`, folded into a half turn because a stadium is symmetric. */
function axisTurn(a: Axis, b: Axis): number {
	let delta = b.ang - a.ang;
	while (delta > Math.PI / 2) delta -= Math.PI;
	while (delta < -Math.PI / 2) delta += Math.PI;
	return delta;
}

/** The outline of a stadium (half length `halfLen`, half width `halfW`) blended toward an ellipse by `mix`. */
function ovalRing(halfLen: number, halfW: number, mix: number): Vec2[] {
	const straight = Math.max(0, halfLen - halfW);
	const t = Math.max(0, Math.min(1, mix));
	const ring: Vec2[] = [];
	for (let i = 0; i < 48; i++) {
		const angle = (i / 48) * Math.PI * 2;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const ex = halfW * cos;
		const ey = halfLen * sin;
		const side = halfW / Math.max(Math.abs(cos), 1e-6);
		let reach: number;
		if (side * Math.abs(sin) <= straight + 1e-6 && Number.isFinite(side)) reach = side;
		else {
			const along = (sin >= 0 ? 1 : -1) * straight * sin;
			const disc = Math.max(0, along * along - straight * straight + halfW * halfW);
			reach = along + Math.sqrt(disc);
		}
		const sx = reach * cos;
		const sy = reach * sin;
		ring.push([sx + (ex - sx) * t, sy + (ey - sy) * t]);
	}
	return ring;
}

function capsuleAt(width: number, height: number, tilt: number, off: Vec2): Eye {
	return capsule(Math.max(width, 1e-4), Math.max(height, width), 0, off, tilt);
}

/** Morphs toward or away from an oval through a stadium. */
function morphOval(from: Eye, to: Eye, t: number): Eye {
	if (t <= 1e-4) return settled(from);
	if (t >= 0.995) return settled(to);
	const a = axisOf(from);
	const b = axisOf(to);
	const turn = axisTurn(a, b);
	const toOval = isOval(to);
	const shaped = toOval ? 1 - (1 - t) ** 3 : t * t * t;
	const angle = a.ang + turn * t;
	const halfLen = Math.max(a.halfLen + (b.halfLen - a.halfLen) * t, 1e-4);
	const halfW = Math.max(a.halfW + (b.halfW - a.halfW) * t, 1e-4);
	const fromMix = +!!isOval(from);
	const mix = fromMix + (+!!toOval - fromMix) * shaped;
	const stadium = capsuleAt(2 * halfW, 2 * halfLen, angle, [a.cx + (b.cx - a.cx) * t, a.cy + (b.cy - a.cy) * t]);
	const hasMix = mix > 1e-4;
	return {
		...stadium,
		oval: hasMix ? [halfW, halfLen] : stadium.oval,
		ovalMix: hasMix ? mix : 0,
		fillRing: ovalRing(halfLen, halfW, mix),
	};
}

/** Morphs between straight strokes as stadiums. */
function morphStadium(from: Eye, to: Eye, t: number): Eye {
	if (t >= 0.9999) return settled(to);
	const a = axisOf(from);
	const b = axisOf(to);
	const angle = a.ang + axisTurn(a, b) * t;
	const halfW = Math.max(1e-4, a.halfW + (b.halfW - a.halfW) * t);
	const straight = Math.max(0, a.halfLen - a.halfW) * (1 - t) + Math.max(0, b.halfLen - b.halfW) * t;
	const centre: Vec2 = [a.cx + (b.cx - a.cx) * t, a.cy + (b.cy - a.cy) * t];
	return capsule(2 * halfW, 2 * (straight + halfW), (angle * 180) / Math.PI, centre, 0);
}

interface EyeBox {
	width: number;
	height: number;
	tilt: number;
	cx: number;
	cy: number;
}

function boxOf(eye: Eye): EyeBox | null {
	const oval = isOval(eye);
	if (!(eye.wid > 0) && !oval) return null;
	const lid = eye.lidY;
	const tilt = eye.tilt * (180 / Math.PI);
	if (oval) return { width: 2 * eye.oval[0], height: 2 * eye.oval[1] * lid, tilt, cx: eye.off[0], cy: eye.off[1] };
	if (eye.pts.length < 2) return null;
	const first = eye.pts[0]!;
	const last = eye.pts[eye.pts.length - 1]!;
	const dx = last[0] - first[0];
	const dy = last[1] - first[1];
	const length = Math.hypot(dx, dy);
	const width = 2 * eye.wid;
	return {
		width,
		height: (length + width) * lid,
		tilt: (180 / Math.PI) * Math.atan2(dx, dy) + tilt,
		cx: eye.off[0] + (first[0] + last[0]) / 2,
		cy: eye.off[1] + ((first[1] + last[1]) / 2) * lid,
	};
}

function boundsOf(eye: Eye): { w: number; h: number; cx: number; cy: number } {
	const box = boxOf(eye);
	if (box == null) return { w: EYE_WIDTH, h: 0.57, cx: eye.off[0], cy: eye.off[1] };
	const radians = (box.tilt * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));
	return { w: box.width * cos + box.height * sin, h: box.width * sin + box.height * cos, cx: box.cx, cy: box.cy };
}

function uprightCapsule(width: number, height: number, x: number, y: number): Eye {
	return height >= width ? capsuleAt(width, height, 0, [x, y]) : capsuleAt(height, width, Math.PI / 2, [x, y]);
}

/** Squeezes an eye toward a short pill for a blink. */
export function squeeze(eye: Eye, amount: number): Eye {
	if (amount <= 0) return eye;
	const t = Math.min(1, amount);
	const bounds = boundsOf(eye);
	const width = Math.max(bounds.w, 1e-4);
	const height = Math.max(bounds.h, width);
	return uprightCapsule(width, height + (width * BLINK_SQUEEZE - height) * t, bounds.cx, bounds.cy);
}

const hidden = (eye: Eye): Eye => ({ ...eye, wid: 0, oval: [0, 0] });

/** Where the lid closes to, measured from the eye's top. */
function lidPivot(eye: Eye): number {
	let top: number;
	let bottom: number;
	if (isOval(eye)) {
		top = -eye.oval[1];
		bottom = eye.oval[1];
	} else {
		let low = 1e9;
		let high = -1e9;
		for (const point of eye.pts) {
			if (point[1] < low) low = point[1];
			if (point[1] > high) high = point[1];
		}
		top = low - eye.wid;
		bottom = high + eye.wid;
	}
	return top + 0.4 * (bottom - top);
}

/** Rotates a mostly vertical stroke upright, folding its lean into `tilt`. */
function upright(eye: Eye): Eye {
	if (eye.pts.length < 2) return eye;
	const first = eye.pts[0]!;
	const last = eye.pts[eye.pts.length - 1]!;
	const dx = last[0] - first[0];
	const dy = last[1] - first[1];
	if (Math.abs(dy) < Math.abs(dx)) return eye;
	const angle = Math.atan2(dx, dy);
	if (Math.abs(angle) < 1e-5) return eye;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return {
		...eye,
		tilt: eye.tilt + angle,
		pts: eye.pts.map((p) => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos]),
	};
}

/** Closes the lid by `amount`. */
function closeLid(eye: Eye, amount: number): Eye {
	if (amount === 0) return eye;
	const turned = upright(eye);
	const open = Math.max(MIN_LID, 1 - amount);
	const shift = lidPivot(turned) * (1 - open);
	const cos = Math.cos(-turned.tilt);
	const sin = Math.sin(-turned.tilt);
	return { ...turned, off: [turned.off[0] - sin * shift, turned.off[1] + cos * shift], lidY: turned.lidY * open };
}

export interface Inspect {
	/** -1 favours the left eye, 1 the right. */
	bias: number;
	/** Pick the bigger eye from the head's turn instead of `bias`. */
	isFollowingTurn: boolean;
}

/** Sizes the eyes apart, like the inspecting face, by `weight`. */
export function inspectEyes(eyes: EyePair, weight: number, inspect: Inspect, yaw: number): EyePair {
	if (weight < 1e-3) return eyes;
	const side = inspect.isFollowingTurn ? Math.min(1, Math.max(-1, yaw / TURN_FOR_FULL_INSPECT)) : inspect.bias;
	const [big, small] = FACES.inspecting;
	const bigWidth = Math.max(1e-4, big.wid);
	const smallWidth = Math.max(1e-4, small.wid);
	const share = (1 + side) / 2;
	const scaled = (eye: Eye, factor: number): Eye => {
		const scale = 1 + (factor - 1) * weight;
		return { ...settled(eye), wid: eye.wid * scale, pts: eye.pts.map((p) => [p[0] * scale, p[1] * scale]) };
	};
	return [scaled(eyes[0], (smallWidth / bigWidth) ** share), scaled(eyes[1], (bigWidth / smallWidth) ** share)];
}

const inspectWeightOf = (name: Expression): number => +(name === "inspecting");

type MorphPath = "oval" | "spine" | "stadium";

function morphPathFor(from: EyePair, to: EyePair, isSpine: boolean): MorphPath {
	return !(from.some(isCurved) || to.some(isCurved)) && (from.some(isOval) || to.some(isOval))
		? "oval"
		: isSpine
			? "spine"
			: "stadium";
}

const MORPH_SECONDS = 0.28;
export const LID_MORPH_SECONDS = 0.35;
export const BLINK_SECONDS = 0.26;
const BLINK_CLOSE_FRAMES = 4.25 / 60;
const BLINK_HOLD_FRAMES = 2 / 60;
const LID_OVERSHOOT = 1.06;

/** When a blink (or lid morph) is fully closed, as fractions of its duration. */
function closedSpan(isBlink: boolean, duration: number): { u1: number; u2: number } {
	const hold = Math.min(0.28, (isBlink ? BLINK_HOLD_FRAMES : BLINK_CLOSE_FRAMES) / Math.max(duration, 0.05));
	const close = (1 - hold) * 0.42;
	return { u1: close, u2: close + hold };
}

/** The lid opening again, with a slight overshoot. */
function reopen(value: number): number {
	const t = Math.min(1, Math.max(0, value));
	if (t < 0.7) {
		const u = t / 0.7;
		return (1 - (1 - u) * (1 - u)) * LID_OVERSHOOT;
	}
	return LID_OVERSHOOT + -0.06000000000000005 * smoothstep01((t - 0.7) / 0.3);
}

function blinkCurve(t: number, { u1, u2 }: { u1: number; u2: number }): number {
	return t < u1 ? smoothstep01(t / u1) : t <= u2 ? 1 : 1 - smoothstep01((t - u2) / Math.max(1e-6, 1 - u2));
}

export interface ExpressionCue {
	t: number;
	name: Expression;
	isThroughBlink: boolean;
}

type Transition =
	| {
			kind: "morph";
			path: MorphPath;
			fromInspect: number;
			toName: Expression;
			from: EyePair;
			to: EyePair;
			t: number;
			dur: number;
			isHeld: boolean;
	  }
	| {
			kind: "lidMorph" | "blink";
			fromInspect: number;
			toName: Expression;
			from: EyePair;
			to: EyePair;
			t: number;
			dur: number;
			isHeld: boolean;
	  };

const morphProgress = (transition: { t: number; dur: number }): number =>
	cubicBezier(Math.min(Math.max(transition.t / transition.dur, 0), 1), EASE_FACE_MORPH as Curve);

export interface FaceController {
	readonly name: Expression;
	readonly isMorphing: boolean;
	eyes(): EyePair;
	inspectWeight(): number;
	/** How closed a running blink is, or null when none runs. */
	blinkAmount(): number | null;
	morph(name: Expression): void;
	lidMorph(name: Expression): void;
	blink(): void;
	play(cue: ExpressionCue): void;
	step(dt: number): void;
	release(): void;
	seek(cues: readonly ExpressionCue[], time: number): void;
}

export function createFace(): FaceController {
	let name: Expression = "neutral";
	let rest: EyePair = mapPair(FACES.neutral, settled);
	let restInspect = 0;
	let transition: Transition | null = null;

	const eyes = (): EyePair => {
		if (transition == null) return rest;
		if (transition.kind === "blink") return transition.from;
		if (transition.kind === "morph") {
			const t = Math.max(0, Math.min(1, morphProgress(transition)));
			const { from, to, path } = transition;
			return path === "oval"
				? mapPair(from, (eye, i) => morphOval(eye, to[i]!, t))
				: path === "spine"
					? mapPair(from, (eye, i) => blendSpine(eye, to[i]!, t))
					: mapPair(from, (eye, i) => morphStadium(eye, to[i]!, t));
		}
		const t = Math.min(transition.t / transition.dur, 1);
		const { u1, u2 } = closedSpan(false, transition.dur);
		if (t < u1) return mapPair(transition.from, (eye) => closeLid(eye, smoothstep01(t / u1)));
		if (t <= u2) return mapPair(transition.to, hidden);
		const open = reopen((t - u2) / Math.max(1e-6, 1 - u2));
		return mapPair(transition.to, (eye) => closeLid(eye, 1 - open));
	};

	const inspectWeight = (): number => {
		if (transition == null) return restInspect;
		if (transition.kind === "blink") return transition.fromInspect;
		const from = transition.fromInspect;
		const to = inspectWeightOf(transition.toName);
		if (transition.kind === "morph") return from + (to - from) * morphProgress(transition);
		const t = Math.min(transition.t / transition.dur, 1);
		const { u1, u2 } = closedSpan(false, transition.dur);
		return t <= u1 ? from : t < u2 ? 0 : to;
	};

	const morph = (target: Expression) => {
		const from = mapPair(eyes(), settled);
		const to = FACES[target];
		transition = {
			kind: "morph",
			path: morphPathFor(
				from,
				to,
				from.some(isCurved) || to.some(isCurved) || name === "sleepy" || target === "sleepy",
			),
			fromInspect: inspectWeight(),
			toName: target,
			from,
			to,
			t: 0,
			dur: MORPH_SECONDS,
			isHeld: false,
		};
		name = target;
	};

	const lidMorph = (target: Expression) => {
		transition = {
			kind: "lidMorph",
			fromInspect: inspectWeight(),
			toName: target,
			from: mapPair(eyes(), settled),
			to: FACES[target],
			t: 0,
			dur: LID_MORPH_SECONDS,
			isHeld: false,
		};
		name = target;
	};

	const blink = () => {
		if (transition == null || transition.isHeld)
			transition = {
				kind: "blink",
				fromInspect: restInspect,
				toName: name,
				from: mapPair(rest, settled),
				to: FACES[name],
				t: 0,
				dur: BLINK_SECONDS,
				isHeld: false,
			};
	};

	const play = (cue: ExpressionCue) => {
		if (cue.name !== name || (transition != null && transition.toName !== cue.name)) {
			if (cue.isThroughBlink && !isLidded(cue.name) && !isLidded(name)) lidMorph(cue.name);
			else morph(cue.name);
		}
	};

	const advanceTo = (current: Transition, time: number) => {
		if (time >= current.dur) {
			rest = mapPair(current.to, settled);
			restInspect = inspectWeightOf(current.toName);
			transition = null;
		} else transition = time < 0 ? null : { ...current, t: time };
	};

	const hold = (isHeld: boolean) => {
		if (transition != null) transition = { ...transition, isHeld };
	};

	return {
		get name() {
			return name;
		},
		get isMorphing() {
			return transition != null && transition.kind !== "blink" && !transition.isHeld;
		},
		eyes,
		inspectWeight,
		blinkAmount() {
			if (transition?.kind !== "blink" || transition.isHeld) return null;
			const t = Math.min(transition.t / transition.dur, 1);
			return Math.min(1, Math.max(0, blinkCurve(t, closedSpan(true, transition.dur))));
		},
		morph,
		lidMorph,
		blink,
		play,
		step(dt) {
			if (transition != null && !transition.isHeld) advanceTo(transition, transition.t + dt);
		},
		release() {
			hold(false);
		},
		seek(cues, time) {
			name = "neutral";
			rest = mapPair(FACES.neutral, settled);
			restInspect = 0;
			transition = null;
			let last = 0;
			const catchUp = (at: number) => {
				if (transition != null) advanceTo(transition, at - last);
			};
			for (const cue of cues) {
				if (cue.t > time + 1e-9) break;
				catchUp(cue.t);
				play(cue);
				last = cue.t;
			}
			catchUp(time);
			hold(true);
		},
	};
}
