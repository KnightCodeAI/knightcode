// The motion engine: plays keyframed clips, bridges between them, and layers looks, pokes, gaze and blinks on top.
import {
	createFace,
	type Expression,
	type ExpressionCue,
	type EyePair,
	type Inspect,
	inspectEyes,
	isLidded,
	LID_MORPH_SECONDS,
	BLINK_SECONDS,
	squeeze,
	takesLids,
	toExpression,
} from "./face.ts";
import {
	clamp,
	type Curve,
	cubicBezier,
	DEG,
	EASE_STANDARD,
	easeInOutCubic,
	type Quat,
	quatFromEuler,
	quatToEuler,
	REST_ROTATION,
	type Spring,
	spring,
	springSteps,
	stepSpring,
	type Vec2,
	type Vec3,
} from "./math.ts";
import { createMorphs, type MorphSnapshot, type MorphTarget } from "./morphs.ts";

/** The engine's internal body names (the user-facing shape names map onto these). */
export const BODIES = [
	"sphere",
	"cloud",
	"square",
	"sparkle",
	"clover",
	"heartChubby",
	"starFlower",
	"teardrop",
	"tablet",
	"wedge",
	"house",
	"star6",
	"pebble",
	"bean",
	"egg",
	"squircle",
	"capsule",
	"cylinder",
	"hex",
	"gem",
	"crystal",
	"shield",
	"dome",
	"arch",
	"leaf",
] as const;
export type Body = (typeof BODIES)[number];

const BODY_ALIASES = new Map<string, Body>([
	["blob", "sphere"],
	["sphereWide", "sphere"],
	["spark", "sparkle"],
	["star", "star6"],
	["heart", "heartChubby"],
	["hexagon", "hex"],
]);

function toBody(name: string): Body {
	const resolved = BODY_ALIASES.get(name) ?? name;
	return BODIES.some((b) => b === resolved) ? (resolved as Body) : "sphere";
}

// ─── Clips ──────────────────────────────────────────────────────────────────

/** A keyframe as stored: time, value and its timing curve. */
type KeySource = [t: number, v: number[], ease: number[]];
/** An expression cue as stored: time, expression name (or "blink"), and `false` to cut through a blink. */
type CueSource = [t: number, name: string, cut?: boolean];

export interface ClipSource {
	name: string;
	duration: number;
	body?: string;
	squashAnchor?: number;
	/** Where the clip's resting pose sits, in seconds. */
	rest?: number;
	inspect?: { bias?: number; follow?: boolean };
	tracks: {
		position?: KeySource[];
		rotation?: KeySource[];
		squash?: KeySource[];
		zoom?: KeySource[];
		lids?: KeySource[];
		expression?: CueSource[];
	};
}

interface Key {
	t: number;
	v: number[];
	ease: Curve;
}

interface Clip {
	duration: number;
	body: Body | null;
	squashAnchor: number;
	restTime: number;
	inspect: { bias?: number; isFollowingTurn?: boolean };
	position: Key[];
	rotation: Key[];
	squash: Key[];
	zoom: Key[];
	lids: Key[];
	expression: ExpressionCue[];
}

const BRIDGE_EASE: Curve = [0.4, 0, 0.2, 1];
/** The camera zoom at rest; sizes and the canvas scale derive from it. */
export const BASE_ZOOM = 0.6;
const REST_DEGREES: Vec3 = (() => {
	const [x, y, z] = quatToEuler(REST_ROTATION);
	return [x / DEG, y / DEG, z / DEG];
})();

const EMPTY_CLIP: Clip = {
	duration: 10,
	body: null,
	squashAnchor: 0,
	restTime: 0,
	inspect: {},
	position: [],
	rotation: [],
	squash: [],
	zoom: [],
	lids: [],
	expression: [],
};
const REST_CLIP: Clip = { ...EMPTY_CLIP, rotation: [{ t: 0, v: REST_DEGREES, ease: EASE_STANDARD }] };
const REST_NAME = "rest";

const toKey = ([t, v, ease]: KeySource): Key => ({
	t,
	v,
	ease: ease != null && ease.length === 4 ? ease : EASE_STANDARD,
});

/** The three lid keys of a scripted blink starting at `t`. */
const blinkKeys = (t: number): Key[] => [
	{ t, v: [0], ease: EASE_STANDARD },
	{ t: t + BLINK_SECONDS * 0.45, v: [1], ease: EASE_STANDARD },
	{ t: t + BLINK_SECONDS, v: [0], ease: EASE_STANDARD },
];

function compileClip(source: ClipSource): Clip {
	const { tracks } = source;
	const keys = (track: KeySource[] | undefined) => (track ?? []).map(toKey);
	const lids = keys(tracks.lids);
	const expression: ExpressionCue[] = [];
	let hasBlink = false;
	for (const [t, name, cut] of tracks.expression ?? []) {
		if (name === "blink") {
			hasBlink = true;
			lids.push(...blinkKeys(t));
		} else expression.push({ t, name: toExpression(name), isThroughBlink: cut === false });
	}
	if (hasBlink) lids.sort((a, b) => a.t - b.t);
	const bias = source.inspect?.bias;
	return {
		duration: source.duration,
		body: toBody(source.body ?? "sphere"),
		squashAnchor: source.squashAnchor ?? 0,
		restTime: source.rest ?? 0,
		inspect: {
			bias: bias !== undefined && Number.isFinite(bias) ? Math.min(1, Math.max(-1, bias)) : undefined,
			isFollowingTurn: source.inspect?.follow,
		},
		position: keys(tracks.position),
		rotation: keys(tracks.rotation),
		squash: keys(tracks.squash),
		zoom: keys(tracks.zoom),
		lids,
		expression,
	};
}

function sample(track: Key[], time: number): number[] | null {
	if (track.length === 0) return null;
	if (time <= track[0]!.t) return track[0]!.v;
	const last = track[track.length - 1]!;
	if (time >= last.t) return last.v;
	let i = 0;
	while (i < track.length - 2 && track[i + 1]!.t <= time) i++;
	const from = track[i]!;
	const to = track[i + 1]!;
	const eased = cubicBezier((time - from.t) / Math.max(to.t - from.t, 1e-9), from.ease);
	return from.v.map((value, k) => value + (to.v[k]! - value) * eased);
}

interface Pose {
	rot: Vec3;
	pos: Vec2;
	scl: Vec2;
	zoom: number;
	lids: number;
	expr: Expression;
	squashAnchor: number;
}

/** A clip's resting pose: where a bridge into it lands. */
function restPose(clip: Clip): Pose {
	const t = clip.restTime;
	const rot = sample(clip.rotation, t);
	const pos = sample(clip.position, t);
	const scl = sample(clip.squash, t);
	const zoom = sample(clip.zoom, t);
	const lids = sample(clip.lids, t);
	let expr: Expression = "neutral";
	let seen = false;
	for (const cue of clip.expression) {
		if (!seen) {
			expr = cue.name;
			seen = true;
		}
		if (cue.t <= t + 1e-9) expr = cue.name;
	}
	return {
		rot: rot ? [rot[0]!, rot[1]!, rot[2]!] : [0, 0, 0],
		pos: pos ? [pos[0]!, pos[1]!] : [0, 0],
		scl: scl ? [scl[0]!, scl[1]!] : [1, 1],
		zoom: zoom ? zoom[0]! : BASE_ZOOM,
		lids: lids ? Math.min(1, Math.max(0, lids[0]!)) : 0,
		expr,
		squashAnchor: clip.squashAnchor,
	};
}

/** `angle` moved by whole turns to sit nearest `near`. */
const unwrapNear = (angle: number, near: number): number => angle + 360 * Math.round((near - angle) / 360);
const angleGap = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

function posesClose(a: Pose, b: Pose): boolean {
	return (
		angleGap(a.rot[0], b.rot[0]) < 4 &&
		angleGap(a.rot[1], b.rot[1]) < 4 &&
		angleGap(a.rot[2], b.rot[2]) < 4 &&
		Math.abs(a.pos[0] - b.pos[0]) < 0.015 &&
		Math.abs(a.pos[1] - b.pos[1]) < 0.015 &&
		Math.abs(a.scl[0] - b.scl[0]) < 0.02 &&
		Math.abs(a.scl[1] - b.scl[1]) < 0.02 &&
		Math.abs(a.zoom - b.zoom) < 0.02 &&
		Math.abs(a.lids - b.lids) < 0.05
	);
}

/** A short clip easing from one pose to another. */
function bridgeClip(from: Pose, to: Pose): Clip {
	const keys = (a: number[], b: number[]): Key[] => [
		{ t: 0, v: a, ease: BRIDGE_EASE },
		{ t: LID_MORPH_SECONDS, v: b, ease: EASE_STANDARD },
	];
	const rot = [
		unwrapNear(to.rot[0], from.rot[0]),
		unwrapNear(to.rot[1], from.rot[1]),
		unwrapNear(to.rot[2], from.rot[2]),
	];
	return {
		...EMPTY_CLIP,
		duration: LID_MORPH_SECONDS,
		squashAnchor: from.squashAnchor,
		position: keys(from.pos, to.pos),
		rotation: keys(from.rot, rot),
		squash: keys(from.scl, to.scl),
		zoom: keys([from.zoom], [to.zoom]),
		lids: from.lids === 0 && to.lids === 0 ? [] : keys([from.lids], [to.lids]),
	};
}

// ─── Looks, pokes and gaze ──────────────────────────────────────────────────

export const LOOKS = {
	left: { rot: [0, -20, 0], pos: [-0.1, 0] },
	right: { rot: [0, 20, 0], pos: [0.1, 0] },
	up: { rot: [-20, 0, 0], pos: [0, 0.1] },
	down: { rot: [20, 0, 0], pos: [0, -0.1] },
	center: { rot: [0, 0, 0], pos: [0, 0] },
} satisfies Record<string, { rot: Vec3; pos: Vec2 }>;
export type Look = keyof typeof LOOKS;

const LOOK_EASE: Curve = [0.42, 0, 0.58, 1];
const LOOK_SECONDS = 0.5;

export const POKES = ["spin", "bounce", "nod"] as const;
export type Poke = (typeof POKES)[number];

interface PokeRun {
	poke: Poke;
	t: number;
	turns: number;
}

function pokeSeconds({ poke, turns }: { poke: Poke; turns: number }): number {
	switch (poke) {
		case "spin":
			return 0.9 + 0.4 * (turns - 1);
		case "bounce":
			return 0.62;
		case "nod":
			return 0.5;
	}
}

/** A sin² bump over [start, end]. */
function bump(t: number, start: number, end: number): number {
	return t <= start || t >= end ? 0 : Math.sin((Math.PI * (t - start)) / (end - start)) ** 2;
}

function pokePose(runs: PokeRun[]) {
	let pitch = 0;
	let yaw = 0;
	let lift = 0;
	let squashX = 1;
	let squashY = 1;
	for (const run of runs) {
		const t = Math.min(1, run.t / pokeSeconds(run));
		switch (run.poke) {
			case "spin":
				yaw += 180 * run.turns * (1 - Math.cos(Math.PI * t));
				break;
			case "nod":
				pitch += 16 * bump(t, 0, 1);
				break;
			case "bounce": {
				const landing = bump(t, 0, 0.18) + bump(t, 0.82, 1);
				const airborne = bump(t, 0.18, 0.82);
				lift += 0.3 * Math.sin(Math.PI * clamp((t - 0.14) / 0.72, 0, 1));
				squashX *= 1 + 0.08 * landing - 0.04 * airborne;
				squashY *= 1 - 0.1 * landing + 0.06 * airborne;
				break;
			}
		}
	}
	return { pitch, yaw, lift, squash: [squashX, squashY] as Vec2 };
}

const FRAME = 1 / 60;
const GAZE_REACH = 0.55;
const GAZE_SOFTNESS: Partial<Record<Body, number>> = { heartChubby: 0.6, wedge: 0.55 };

const gazeFollow = (dt: number): number => 1 - 0.86 ** (dt / FRAME);

/** How far the head turns and shifts toward a gaze point in [-1, 1]². */
function gazePose(body: Body, x: number, y: number) {
	const isShape = body !== "sphere";
	const soft = GAZE_SOFTNESS[body] ?? 1;
	return {
		rx: -(isShape ? 19 : 14) * soft * y,
		ry: (isShape ? 26 : 18) * soft * x,
		px: (isShape ? 0.07 : 0.03) * x,
		py: (isShape ? 0.055 : 0.024) * y,
	};
}

/** The gaze point for a pointer, in [-1, 1]² around an element, reaching full turn `reach` widths away. */
export function pointerGaze(
	rect: { left: number; top: number; width: number; height: number },
	point: { x: number; y: number },
	reach = 2,
): Vec2 {
	const span = Math.max(rect.width, 1) * reach;
	const limit = (v: number) => Math.max(-1, Math.min(1, v));
	return [
		limit((point.x - (rect.left + rect.width / 2)) / span),
		limit(-(point.y - (rect.top + rect.height / 2)) / span),
	];
}

// ─── The engine ─────────────────────────────────────────────────────────────

export interface BodyWeight {
	body: Body;
	weight: number;
}

/** Everything the renderer needs for one frame. */
export interface Frame {
	body: Body;
	quat: Quat;
	zoom: number;
	offset: Vec2;
	squash: Vec2;
	squashAnchor: number;
	eyes: EyePair | null;
	inspectWeight: number;
	bodies: BodyWeight[];
	morph: MorphSnapshot | null;
}

export interface LoadOptions {
	isPlaying?: boolean;
	transition?: "bridge" | "cut";
	/** Start this far into the clip, as a fraction of its length. */
	phase?: number;
}

export interface Engine {
	readonly isPlaying: boolean;
	readonly isSettled: boolean;
	readonly loopCount: number;
	readonly face: Expression;
	load(source: ClipSource, options?: LoadOptions): void;
	play(): void;
	pause(): void;
	rest(): void;
	seek(time: number): void;
	setBody(body: Body, options?: { isInstant?: boolean }): void;
	setMorph(target: MorphTarget | null, options?: { isInstant?: boolean }): void;
	setExpression(name: Expression, options?: { isThroughBlink?: boolean }): void;
	holdFace(name: Expression | null): void;
	poke(kind: Poke, options?: { turns?: number }): void;
	blink(): void;
	setGaze(point: readonly [number, number] | null): void;
	setGazeAlways(isAlways: boolean): void;
	look(direction: Look): void;
	advance(dt: number): void;
	frame(): Frame;
}

interface Loaded {
	clip: Clip;
	name: string;
	isPlaying: boolean;
	phase: number;
	isRest: boolean;
}

const MAX_STEP = 0.1;
const BODY_BLEND_OMEGA = 10;
const MIN_BODY_WEIGHT = 1e-4;
/** Past this much morph, the face hides behind the overlay. */
const FACE_HIDES_AT = 0.5;
const GAZE_SNAP = 1e-3;

const wholeTurns = (degrees: number): number => 360 * Math.round(degrees / 360);

function expressionAt(cues: readonly ExpressionCue[], time: number): Expression {
	let name: Expression = "neutral";
	for (const cue of cues) {
		if (cue.t > time + 1e-9) break;
		name = cue.name;
	}
	return name;
}

export function createEngine(options: { body?: Body; zoomMul?: number; isGazeAlways?: boolean } = {}): Engine {
	const zoomMul = Math.min(3, Math.max(0.2, options.zoomMul || 1));
	const face = createFace();
	let body: Body = options.body ?? "sphere";
	let isBodyFixed = options.body !== undefined;
	let fading: BodyWeight[] = [];
	const bodyBlend: Spring = spring(1);
	const morphs = createMorphs();
	let spinBase: Vec3 | null = null;
	let rot: Vec3 = REST_DEGREES;
	let pos: Vec2 = [0, 0];
	let scl: Vec2 = [1, 1];
	let squashAnchor = 0;
	let zoom = BASE_ZOOM * zoomMul;
	let inspect: Inspect = { bias: -1, isFollowingTurn: true };
	let look: { t: number; fromRot: Vec3; toRot: Vec3; fromPos: Vec2; toPos: Vec2 } | null = null;
	let gaze = { isHeld: false, isAlways: options.isGazeAlways ?? false, x: 0, y: 0, cx: 0, cy: 0, hold: 0 };
	let clip: Clip = REST_CLIP;
	let time = 0;
	let isPlaying = false;
	let isLooping = true;
	let isPaused = false;
	let current: { clip: Clip; name: string } | null = null;
	let pending: Loaded | null = null;
	let loopCount = 0;
	let heldFace: Expression | null = null;
	let deferred: (() => void) | null = null;
	let lidsMuted = false;
	let pokes: PokeRun[] = [];

	const applyPose = () => {
		const p = sample(clip.position, time);
		pos = p ? [p[0]!, p[1]!] : [0, 0];
		const r = sample(clip.rotation, time);
		rot = r ? [r[0]!, r[1]!, r[2]!] : [0, 0, 0];
		const s = sample(clip.squash, time);
		scl = s ? [s[0]!, s[1]!] : [1, 1];
		const z = sample(clip.zoom, time);
		if (z) zoom = Math.min(2.5, Math.max(0.25, z[0]!)) * zoomMul;
	};

	/** Runs `action` now, or once the eyes reopen. */
	const whenOpen = (action: () => void) => {
		if ((face.blinkAmount() ?? lids()) > 0) deferred = action;
		else {
			action();
			updateLidMute();
		}
	};

	const cueExpressions = (from: number, to: number) => {
		if (heldFace == null)
			for (const cue of clip.expression) if (!(cue.t <= from || cue.t > to)) whenOpen(() => face.play(cue));
	};

	const seek = (at: number) => {
		time = at;
		look = null;
		deferred = null;
		applyPose();
		face.seek(clip.expression, at);
		if (heldFace != null) face.seek([{ t: 0, name: heldFace, isThroughBlink: false }], 0);
	};

	const clipLids = (): number => {
		const v = sample(clip.lids, time);
		return v ? Math.min(1, Math.max(0, v[0]!)) : 0;
	};
	const lids = (): number => (lidsMuted ? 0 : clipLids());
	const updateLidMute = () => {
		if (!takesLids(face.name) || face.isMorphing) lidsMuted = true;
		else if (lidsMuted && clipLids() === 0) lidsMuted = false;
	};

	const pose = (): Pose => ({ rot, pos, scl, zoom: zoom / zoomMul, lids: lids(), expr: face.name, squashAnchor });

	const enter = (next: Clip) => {
		isPlaying = false;
		clip = next;
		time = 0;
		squashAnchor = next.squashAnchor;
		if (next.body != null && !isBodyFixed) body = next.body;
		inspect = {
			bias: next.inspect.bias ?? inspect.bias,
			isFollowingTurn: next.inspect.isFollowingTurn ?? inspect.isFollowingTurn,
		};
	};

	const start = (entry: Loaded) => {
		pending = null;
		enter(entry.clip);
		current = { clip: entry.clip, name: entry.name };
		isLooping = true;
		if (entry.isPlaying) {
			isPlaying = true;
			if (entry.phase > 0) seek(entry.phase * entry.clip.duration);
			face.release();
			if (entry.phase <= 0) cueExpressions(-1e-9, 0);
		} else {
			seek(0);
			if (entry.isRest) gaze = { ...gaze, hold: 0 };
		}
	};

	const bridgeTo = (entry: Loaded) => {
		const from = pose();
		const to = restPose(entry.clip);
		pending = entry;
		enter(bridgeClip(from, to));
		isLooping = false;
		isPlaying = true;
		if (heldFace == null && from.expr !== to.expr) whenOpen(() => face.morph(to.expr));
	};

	/** At a loop's end, bridges back to the clip's rest when the pose has drifted from it. */
	const rebridge = (): boolean => {
		if (pending != null || current == null || posesClose(pose(), restPose(current.clip))) return false;
		bridgeTo({ ...current, isPlaying: true, phase: 0, isRest: false });
		return true;
	};

	const play = (dt: number) => {
		const from = time;
		let to = from + dt;
		if (to >= clip.duration) {
			cueExpressions(from, clip.duration);
			if (isLooping) {
				loopCount += 1;
				if (rebridge()) return;
				to -= clip.duration;
				if (to >= clip.duration) to = 0;
				cueExpressions(-1e-9, to);
				time = to;
			} else {
				time = clip.duration;
				isPlaying = false;
				if (pending != null) start(pending);
			}
		} else {
			cueExpressions(from, to);
			time = to;
		}
		look = null;
		applyPose();
	};

	const approach = (from: number, to: number, t: number): number => {
		const value = from + (to - from) * t;
		return Math.abs(to - value) < GAZE_SNAP ? to : value;
	};

	const followGaze = (dt: number) => {
		if (isPaused || (!gaze.isHeld && gaze.hold === 0)) return;
		const t = gazeFollow(dt);
		gaze = {
			...gaze,
			cx: approach(gaze.cx, gaze.x, t),
			cy: approach(gaze.cy, gaze.y, t),
			hold: approach(gaze.hold, +!!gaze.isHeld, t),
		};
		if (isPlaying) return;
		applyPose();
		const target = gazePose(body, gaze.cx, gaze.cy);
		const { hold } = gaze;
		rot = [rot[0] + (target.rx - rot[0]) * hold, rot[1] + (target.ry - rot[1]) * hold, rot[2] * (1 - hold)];
		pos = [pos[0] + (target.px - pos[0]) * hold, pos[1] + (target.py - pos[1]) * hold];
	};

	const stepLook = (dt: number) => {
		if (look == null) return;
		const t = look.t + dt;
		const progress = Math.min(t / LOOK_SECONDS, 1);
		const eased = cubicBezier(progress, LOOK_EASE);
		const { fromRot, toRot, fromPos, toPos } = look;
		rot = [
			fromRot[0] + (toRot[0] - fromRot[0]) * eased,
			fromRot[1] + (toRot[1] - fromRot[1]) * eased,
			fromRot[2] + (toRot[2] - fromRot[2]) * eased,
		];
		pos = [fromPos[0] + (toPos[0] - fromPos[0]) * eased, fromPos[1] + (toPos[1] - fromPos[1]) * eased];
		if (progress >= 1) {
			rot = toRot;
			pos = toPos;
			look = null;
		} else look = { ...look, t };
	};

	const bodyWeights = (): BodyWeight[] => {
		if (fading.length === 0) return [{ body, weight: 1 }];
		const share = easeInOutCubic(clamp(bodyBlend.x, 0, 1));
		const totals = new Map<Body, number>();
		for (const entry of fading) totals.set(entry.body, (totals.get(entry.body) ?? 0) + entry.weight * (1 - share));
		totals.set(body, (totals.get(body) ?? 0) + share);
		const kept = [...totals].filter(([, weight]) => weight > MIN_BODY_WEIGHT);
		const sum = kept.reduce((total, [, weight]) => total + weight, 0);
		return kept.map(([b, weight]) => ({ body: b, weight: weight / sum }));
	};

	const blendToBody = (next: Body) => {
		if (next !== body) {
			fading = bodyWeights();
			body = next;
			bodyBlend.x = 0;
			bodyBlend.v = 0;
			bodyBlend.t = 1;
		}
	};

	const stepBodyBlend = (dt: number) => {
		if (fading.length === 0) return;
		const steps = springSteps(dt);
		for (let i = 0; i < steps; i++) stepSpring(bodyBlend, BODY_BLEND_OMEGA, 1, dt / steps);
		if (Math.abs(bodyBlend.x - 1) < 1e-3 && Math.abs(bodyBlend.v) < 0.01) {
			bodyBlend.x = 1;
			bodyBlend.v = 0;
			fading = [];
		}
	};

	const closedness = (): number => face.blinkAmount() ?? lids();

	const faceEyes = (yaw: number, inspectWeight: number): EyePair => {
		const eyes = inspectEyes(face.eyes(), inspectWeight, inspect, yaw);
		const closed = closedness();
		return closed <= 1e-4 ? eyes : [squeeze(eyes[0], closed), squeeze(eyes[1], closed)];
	};

	return {
		get isPlaying() {
			return isPlaying;
		},
		get loopCount() {
			return loopCount;
		},
		get face() {
			return face.name;
		},
		get isSettled() {
			const isGazeSettled =
				isPaused || (gaze.hold === +!!gaze.isHeld && (!gaze.isHeld || (gaze.cx === gaze.x && gaze.cy === gaze.y)));
			return (
				!isPlaying &&
				pokes.length === 0 &&
				fading.length === 0 &&
				look == null &&
				deferred == null &&
				!face.isMorphing &&
				face.blinkAmount() == null &&
				morphs.snapshot().isSettled &&
				isGazeSettled
			);
		},
		load(source, { isPlaying: playing = true, transition = "bridge", phase = 0 } = {}) {
			const name = source.name || current?.name || "recipe";
			const entry: Loaded = {
				clip: compileClip(source),
				name,
				isPlaying: playing,
				phase: clamp(phase, 0, 1) % 1,
				isRest: false,
			};
			if (transition === "bridge" && current != null && (pending != null || current.name !== name)) bridgeTo(entry);
			else start(entry);
		},
		play() {
			isPaused = false;
			isPlaying = true;
		},
		pause() {
			isPaused = true;
			isPlaying = false;
		},
		rest() {
			isPaused = false;
			const entry: Loaded = { clip: REST_CLIP, name: REST_NAME, isPlaying: false, phase: 0, isRest: true };
			if (pending == null && (current == null || current.name === REST_NAME)) {
				if (current == null) start(entry);
			} else bridgeTo(entry);
		},
		seek,
		setBody(next, { isInstant = false } = {}) {
			isBodyFixed = true;
			if (!isInstant) blendToBody(next);
			else {
				body = next;
				fading = [];
				bodyBlend.x = 1;
				bodyBlend.v = 0;
			}
		},
		setMorph(target, { isInstant = false } = {}) {
			morphs.set(target);
			if (isInstant) morphs.settle();
		},
		setExpression(name, { isThroughBlink = false } = {}) {
			whenOpen(() => {
				if (isThroughBlink && !isLidded(name) && !isLidded(face.name)) face.lidMorph(name);
				else face.morph(name);
			});
		},
		holdFace(name) {
			if (name !== heldFace) {
				heldFace = name;
				whenOpen(() => {
					const target =
						heldFace ??
						(pending == null ? expressionAt(clip.expression, time) : expressionAt(pending.clip.expression, 0));
					if (target !== face.name) face.morph(target);
				});
			}
		},
		poke(kind, { turns = 1 } = {}) {
			pokes = [...pokes, { poke: kind, t: 0, turns: Math.max(1, Math.round(turns)) }];
		},
		blink() {
			face.blink();
		},
		setGaze(point) {
			if (point == null) {
				gaze = { ...gaze, isHeld: false };
				return;
			}
			const x = clamp(point[0] || 0, -1, 1);
			const y = clamp(point[1] || 0, -1, 1);
			gaze = gaze.hold === 0 ? { ...gaze, isHeld: true, x, y, cx: x, cy: y } : { ...gaze, isHeld: true, x, y };
		},
		setGazeAlways(isAlways) {
			gaze = { ...gaze, isAlways };
		},
		look(direction) {
			const target = LOOKS[direction];
			look = { t: 0, fromRot: rot, toRot: target.rot as Vec3, fromPos: pos, toPos: target.pos as Vec2 };
		},
		advance(seconds) {
			const dt = Math.min(seconds, MAX_STEP);
			followGaze(dt);
			const clipSpeed = 1 - morphs.snapshot().amount;
			if (isPlaying) play(dt * clipSpeed);
			stepLook(dt);
			face.step(dt);
			if (deferred != null && (face.blinkAmount() ?? lids()) === 0) {
				const action = deferred;
				deferred = null;
				action();
			}
			updateLidMute();
			stepBodyBlend(dt);
			pokes = pokes.map((run) => ({ ...run, t: run.t + dt })).filter((run) => run.t < pokeSeconds(run));
			morphs.advance(dt);
			const morph = morphs.snapshot();
			if (morph.amount > 0 || !morph.isSettled)
				spinBase ??= [wholeTurns(rot[0]), wholeTurns(rot[1]), wholeTurns(rot[2])];
			else spinBase = null;
		},
		frame() {
			const lean = gaze.isAlways && isPlaying && !isPaused ? gazePose(body, gaze.cx, gaze.cy) : null;
			const reach = GAZE_REACH * gaze.hold;
			const poked = pokePose(pokes);
			const turned: Vec3 = [
				rot[0] + (lean ? lean.rx * reach : 0) + poked.pitch,
				rot[1] + (lean ? lean.ry * reach : 0) + poked.yaw,
				rot[2],
			];
			const shifted: Vec2 = [pos[0] + (lean ? lean.px * reach : 0), pos[1] + (lean ? lean.py * reach : 0) + poked.lift];
			const squashed: Vec2 = [scl[0] * poked.squash[0], scl[1] * poked.squash[1]];
			const inspectWeight = face.inspectWeight();
			const morph = morphs.snapshot();
			const presence = 1 - morph.amount;
			const spin = (morph.spin % (2 * Math.PI)) / DEG;
			const base = spinBase ?? [0, 0, 0];
			const angle = (k: number) => base[k]! + (turned[k]! - base[k]!) * presence;
			const yaw = angle(1);
			return {
				body,
				quat: quatFromEuler(angle(0) * DEG, (yaw + spin) * DEG, angle(2) * DEG),
				zoom,
				offset: presence === 1 ? shifted : [shifted[0] * presence, shifted[1] * presence],
				squash: presence === 1 ? squashed : [1 + (squashed[0] - 1) * presence, 1 + (squashed[1] - 1) * presence],
				squashAnchor,
				eyes: morph.amount >= FACE_HIDES_AT ? null : faceEyes(yaw, inspectWeight),
				inspectWeight,
				bodies: bodyWeights(),
				morph: morph.kind === null && morph.isSettled ? null : morph,
			};
		},
	};
}
