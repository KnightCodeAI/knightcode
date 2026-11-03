// Morphs: the body shrinks into a small mark while an overlay (dots, rings, a pencil, ...) shows what the bot is doing.
import {
	clamp,
	easeInOutCubic,
	easeOutBack,
	easeOutCubic,
	hermite,
	random,
	type Spring,
	spring,
	springSteps,
	stepSpring,
	type Vec2,
} from "./math.ts";
import { CENTRE, teardropOutline } from "./outlines.ts";

/** The states that morph, and the overlay each shows. */
export const MORPH_FOR_STATE = {
	thinking: "dots",
	orbit: "orbit",
	radar: "radar",
	progress: "progress",
	spawning: "gather",
	dictating: "wave",
	sending: "send",
	receiving: "receive",
	uploading: "dock",
	bouncing: "ball",
	writing: "pencil",
	alerting: "bang",
	"powering-down": "standby",
} as const;
export type MorphTarget = keyof typeof MORPH_FOR_STATE;
export type MorphKind = (typeof MORPH_FOR_STATE)[MorphTarget];

/** Overlays that play as timed shots: shown for a while, then hidden for a pause, then again. */
const SHOT_SECONDS: Partial<Record<MorphTarget, number>> = { progress: 2.5, spawning: 2 };
const SHOT_PAUSE_SECONDS = 1.5;
export const shotSeconds = (target: MorphTarget): number => SHOT_SECONDS[target] ?? 2.5;
const MAX_STEP = 0.1;
const DEFAULT_SEED = 2654435769;

export interface MorphClock {
	/** Seconds since this overlay appeared. */
	stateTime: number;
	/** Seconds since the current shot began. */
	shotTime: number;
}

export interface MorphSnapshot {
	/** How far the body has turned into the mark, 0 to 1. */
	amount: number;
	/** Extra yaw, in radians, the head spins while morphing. */
	spin: number;
	kind: MorphKind | null;
	/** The overlay fading out while `kind` fades in. */
	outgoing: MorphKind | null;
	/** How far `kind` has replaced `outgoing`. */
	swap: number;
	clock: MorphClock;
	outgoingClock: MorphClock;
	isReducedMotion: boolean;
	isSettled: boolean;
}

export interface Morphs {
	set(target: MorphTarget | null): void;
	advance(dt: number): void;
	settle(): void;
	snapshot(): MorphSnapshot;
}

export function createMorphs(options: { isReducedMotion?: boolean; seed?: number } = {}): Morphs {
	const isReduced = options.isReducedMotion ?? false;
	const next = random(options.seed ?? DEFAULT_SEED);
	const amount: Spring = spring(0);
	const swap: Spring = spring(1);
	const spin: Spring = spring(0);
	let target: MorphTarget | null = null;
	let seenTarget: MorphTarget | null = null;
	let kind: MorphKind | null = null;
	let outgoing: MorphKind | null = null;
	let isShotPaused = false;
	let pausedAt = 0;
	let spinTarget = 0;
	let spinDirection = 1;
	let isShown = false;
	let clock = 0;
	let stateStart = 0;
	let shotStart = 0;
	let outgoingStateStart = 0;
	let outgoingShotStart = 0;

	const update = () => {
		const wanted = target == null ? null : MORPH_FOR_STATE[target];
		const previousShotStart = shotStart;
		if (target !== seenTarget) {
			seenTarget = target;
			if (target != null) {
				shotStart = clock;
				isShotPaused = false;
			}
		}
		let show = wanted != null;
		if (target != null && SHOT_SECONDS[target] !== undefined) {
			if (!isShotPaused && clock - shotStart > shotSeconds(target)) {
				isShotPaused = true;
				pausedAt = clock;
			} else if (isShotPaused && clock - pausedAt > SHOT_PAUSE_SECONDS) {
				isShotPaused = false;
				shotStart = clock;
			}
			show = !isShotPaused;
		}
		amount.t = +!!show;
		if (wanted != null && wanted !== kind) {
			if (kind != null && amount.x > 0.02) {
				outgoing = kind;
				outgoingStateStart = stateStart;
				outgoingShotStart = previousShotStart;
				swap.x = +!!isReduced;
			} else {
				outgoing = null;
				swap.x = 1;
			}
			swap.v = 0;
			swap.t = 1;
			kind = wanted;
			stateStart = clock;
		}
		if (wanted == null && amount.x < 4e-3) {
			kind = null;
			outgoing = null;
		}
		if (swap.x > 0.996) outgoing = null;
		if (show !== isShown) {
			if (show && !isReduced) spinDirection = next() < 0.5 ? 1 : -1;
			if (!isReduced) {
				spinTarget += Math.PI * spinDirection;
				spin.t = spinTarget;
			}
			isShown = show;
		}
	};

	return {
		set(value) {
			target = value;
		},
		advance(seconds) {
			const dt = seconds > 0 ? Math.min(seconds, MAX_STEP) : 0;
			clock += dt;
			update();
			const steps = springSteps(dt);
			const step = dt / steps;
			for (let i = 0; i < steps; i++) {
				stepSpring(amount, 14, 1, step);
				stepSpring(swap, 11, 1, step);
				stepSpring(spin, 14, 1, step);
			}
			if (isReduced) {
				swap.x = 1;
				spin.x = spin.t;
				amount.x = amount.t;
			}
		},
		settle() {
			update();
			for (const s of [amount, swap, spin]) {
				s.x = s.t;
				s.v = 0;
			}
			update();
		},
		snapshot() {
			return {
				amount: clamp(amount.x, 0, 1),
				spin: spin.x,
				kind,
				outgoing,
				swap: clamp(swap.x, 0, 1),
				clock: { stateTime: clock - stateStart, shotTime: clock - shotStart },
				outgoingClock: { stateTime: clock - outgoingStateStart, shotTime: clock - outgoingShotStart },
				isReducedMotion: isReduced,
				isSettled: Math.abs(amount.x - amount.t) < 1e-3 && Math.abs(spin.t - spin.x) < 0.01 && swap.x > 0.996,
			};
		},
	};
}

// ─── Overlays ───────────────────────────────────────────────────────────────
// Overlay parts are drawn in the same 228.541 box as the outlines, centred on `CENTRE`.

const L = CENTRE;
const TAU = Math.PI * 2;
/** Where the overlay zoom pivots, slightly below centre. */
export const MARK_PIVOT = 114.5;
const ROUND_BY = 0.62;
const RING_POINTS = 96;

/** The radius the body shrinks to for each overlay, in box units. */
const CORE_RADIUS: Record<MorphKind, number> = {
	dots: 22,
	orbit: 19,
	radar: 19,
	progress: 19,
	gather: 19,
	wave: 16,
	send: 20,
	receive: 20,
	dock: 20,
	ball: 18,
	pencil: 17,
	bang: 13,
	standby: 13,
};
/** How far the whole avatar zooms in while each overlay shows. */
const OVERLAY_ZOOM: Record<MorphKind, number> = {
	dots: 1.5,
	orbit: 1.14,
	radar: 1.14,
	progress: 1.32,
	gather: 1.15,
	wave: 1.42,
	send: 1.12,
	receive: 1.12,
	dock: 1.3,
	ball: 1.22,
	pencil: 1.18,
	bang: 1.28,
	standby: 1.75,
};

const DOT_RADIUS = 22;
const DOT_SPREAD = 62;
const DOT_REST_SCALE = 0.84;
const DOT_PEAK_SCALE = 0.22;
const DOT_BOOST = 1.02;
const DOT_LIFT = 9;
const DOTS_PERIOD = 1400;
const SEND_PERIOD = 1500;
const RECEIVE_PERIOD = 1700;
const PENCIL_PERIOD = 2500;
const PENCIL_DRAW_SHARE = 0.68;
const PENCIL_DRAW_MS = PENCIL_PERIOD * PENCIL_DRAW_SHARE;
const TRAIL_SPACING = 2.4;
const TRAIL_FADE_PER_SECOND = 120;
const PROGRESS_MS = shotSeconds("progress") * 1e3;
const GATHER_MS = shotSeconds("spawning") * 1e3;
const WAVE_BARS = [-2, -1, 1, 2];

const fraction = (value: number): number => ((value % 1) + 1) % 1;

/** Rotates a closed ring of points by `shift` slots, keeping it the same shape. */
const rotateRing = (ring: Vec2[], shift: number): Vec2[] => {
	const count = ring.length;
	const angle = (shift / count) * Math.PI * 2;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return Array.from({ length: count }, (_, i) => {
		const [x, y] = ring[(((i - shift) % count) + count) % count]!;
		const dx = x - L;
		const dy = y - L;
		return [L + dx * cos - dy * sin, L + dx * sin + dy * cos];
	});
};

const CIRCLE: Vec2[] = Array.from({ length: RING_POINTS }, (_, i) => {
	const angle = (i / RING_POINTS) * TAU;
	return [L + Math.cos(angle) * L, L + Math.sin(angle) * L];
});

let pencilRing: Vec2[] | null = null;
/** The pencil's mark is a teardrop pointing down. */
const ringFor = (kind: MorphKind | null): Vec2[] => {
	if (kind !== "pencil") return CIRCLE;
	if (pencilRing == null) {
		const ring = teardropOutline(88, 18).ring;
		pencilRing = rotateRing(ring, ring.length / 2);
	}
	return pencilRing;
};

const lerpRings = (a: Vec2[], b: Vec2[], t: number): Vec2[] =>
	a.map(([x, y], i) => [x + (b[i]![0] - x) * t, y + (b[i]![1] - y) * t]);

function capsulePath(width: number, height: number): string {
	const r = width / 2;
	const top = L - height / 2 + r;
	const bottom = L + height / 2 - r;
	return `M${L - r} ${top}A${r} ${r} 0 0 1 ${L + r} ${top}L${L + r} ${bottom}A${r} ${r} 0 0 1 ${L - r} ${bottom}Z`;
}

function taperPath(topWidth: number, bottomWidth: number, height: number): string {
	const r = topWidth / 2;
	const b = bottomWidth / 2;
	const top = L - height / 2;
	const bottom = L + height / 2;
	return `M${L - r} ${top + r}A${r} ${r} 0 0 1 ${L + r} ${top + r}L${L + b} ${bottom - b}A${b} ${b} 0 0 1 ${L - b} ${bottom - b}Z`;
}

const PENCIL_SHAFT = capsulePath(30, 88);
const ALERT_BAR = taperPath(30, 17, 96);

export type OverlayPart =
	| { type: "disc"; key: string; cx: number; cy: number; r: number; opacity: number }
	| {
			type: "ring";
			key: string;
			cx: number;
			cy: number;
			r: number;
			width: number;
			opacity: number;
			arc?: { fraction: number; startDeg: number };
	  }
	| { type: "shape"; key: string; d: string; transform: string; opacity: number }
	| { type: "stroke"; key: string; d: string; width: number; opacity: number };

const disc = (key: string, cx: number, cy: number, r: number, opacity: number): OverlayPart => ({
	type: "disc",
	key,
	cx,
	cy,
	r,
	opacity,
});
const ring = (key: string, r: number, width: number, opacity: number): OverlayPart => ({
	type: "ring",
	key,
	cx: L,
	cy: L,
	r,
	width,
	opacity,
});
const shape = (key: string, d: string, transform: string, opacity: number): OverlayPart => ({
	type: "shape",
	key,
	d,
	transform,
	opacity,
});
const stroke = (key: string, d: string, width: number, opacity: number): OverlayPart => ({
	type: "stroke",
	key,
	d,
	width,
	opacity,
});

const STILL_DOT = { lift: 0, pop: 1, tone: 1 };

/** A thinking dot's hop: each of three slots peaks in turn. */
function dotHop(clock: MorphClock, slot: number, presence: number, isReduced: boolean) {
	const phase = fraction((clock.stateTime * 1e3) / DOTS_PERIOD + 0.119);
	const distance = Math.abs(phase - slot / 3);
	const wrapped = Math.min(distance, 1 - distance);
	const peak = isReduced ? 1 : Math.exp(-(wrapped * wrapped) / 0.045);
	const moving = +!isReduced;
	return {
		lift: peak * DOT_LIFT * presence * moving,
		pop: 1 + moving * (DOT_REST_SCALE + DOT_PEAK_SCALE * peak - 1),
		tone: 1 - moving * 0.5 * (1 - peak),
	};
}

const voiceLevel = (ms: number): number =>
	0.42 + 0.29 * Math.sin(ms * 21e-4) * Math.sin(ms * 34e-4) + 0.29 * Math.sin(ms * 13e-4 + 1.7);
const barLevel = (ms: number, bar: number): number =>
	voiceLevel(ms) * (0.55 + 0.45 * Math.sin(ms * 0.012 - Math.abs(bar) * 1.05));
const arrivalAngle = (index: number): number => -Math.PI * 1.25 + random(index)() * Math.PI * 1.5;

/** The ball's height: a drop under gravity, then bounces. */
function ballHeight(seconds: number): number {
	const period = 0.62;
	const gravity = 416 / (period * period);
	const drop = Math.sqrt(80 / gravity);
	if (seconds < drop) return 0.5 * gravity * seconds * seconds;
	const t = fraction((seconds - drop) / period);
	return 40 - 208 * t * (1 - t);
}

/** The pencil: writes left to right, then lifts back. */
function pencilAt(ms: number) {
	const t = fraction(ms / PENCIL_PERIOD);
	if (t < PENCIL_DRAW_SHARE) {
		const u = t / PENCIL_DRAW_SHARE;
		const eased = u * u * (3 - 2 * u);
		const wiggle = clamp(u / 0.08, 0, 1) * clamp((1 - u) / 0.08, 0, 1);
		return { x: -54 + 118 * eased, y: 26, wig: Math.sin(u * 24) * 3.2 * wiggle, rot: 17 + Math.sin(ms * 6e-4) * 1 };
	}
	const back = easeInOutCubic((t - PENCIL_DRAW_SHARE) / 0.31999999999999995);
	return {
		x: 64 - 118 * back,
		y: 26 - 20 * Math.sin(back * Math.PI),
		wig: 0,
		rot: 17 - 2 * Math.sin(back * Math.PI) + Math.sin(ms * 6e-4) * 1,
	};
}

const pencilTip = (ms: number): Vec2 => {
	const at = pencilAt(ms);
	return [L + at.x, L + at.y + at.wig + 19];
};

let pencilTrail: { at: number; point: Vec2 }[] | null = null;
function trailPoints() {
	if (pencilTrail == null) {
		const points: { at: number; point: Vec2 }[] = [];
		for (let ms = 0; ms < PENCIL_DRAW_MS; ms++) {
			const point = pencilTip(ms);
			const last = points[points.length - 1];
			if (last === undefined || Math.hypot(point[0] - last.point[0], point[1] - last.point[1]) > TRAIL_SPACING)
				points.push({ at: ms, point });
		}
		pencilTrail = points;
	}
	return pencilTrail;
}

/** The ink line drawn so far this cycle, fading from its start once the pencil lifts. */
function inkTrail(ms: number): Vec2[] {
	const t = fraction(ms / PENCIL_PERIOD) * PENCIL_PERIOD;
	const drawn = Math.min(t, PENCIL_DRAW_MS);
	const passed = trailPoints().filter((p) => p.at <= drawn);
	const tip = drawn > (passed.length > 0 ? passed[passed.length - 1]!.at : drawn) ? [pencilTip(drawn)] : [];
	const points = [...passed.map((p) => p.point), ...tip].slice(-64);
	return t < PENCIL_DRAW_MS ? points : points.slice(Math.floor(((t - PENCIL_DRAW_MS) / 1e3) * TRAIL_FADE_PER_SECOND));
}

function smoothPath(points: Vec2[]): string {
	const count = points.length;
	let d = `M${points[0]![0].toFixed(1)} ${points[0]![1].toFixed(1)}`;
	if (count === 2) return d + `L${points[1]![0].toFixed(1)} ${points[1]![1].toFixed(1)}`;
	for (let i = 0; i < count - 1; i++) {
		const before = points[Math.max(i - 1, 0)]!;
		const from = points[i]!;
		const to = points[i + 1]!;
		const after = points[Math.min(i + 2, count - 1)]!;
		const c1x = from[0] + (to[0] - before[0]) / 6;
		const c1y = from[1] + (to[1] - before[1]) / 6;
		const c2x = to[0] - (after[0] - from[0]) / 6;
		const c2y = to[1] - (after[1] - from[1]) / 6;
		d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${to[0].toFixed(1)} ${to[1].toFixed(1)}`;
	}
	return d;
}

function dotsParts(presence: number, clock: MorphClock, isReduced: boolean): OverlayPart[] {
	const xs = [L - DOT_SPREAD, L + DOT_SPREAD];
	const parts: OverlayPart[] = [];
	for (let i = 0; i < 2; i++) {
		const t = clamp((presence - i * 0.12) / (1 - i * 0.12), 0, 1);
		if (t <= 4e-3) continue;
		const grow = easeOutCubic(t);
		const spread = easeOutBack(t);
		const hop = dotHop(clock, i === 0 ? 0 : 2, presence, isReduced);
		parts.push(
			disc(
				`dots.${i}`,
				L + (xs[i]! - L) * spread,
				L - hop.lift,
				DOT_RADIUS * grow * hop.pop * DOT_BOOST,
				grow * hop.tone,
			),
		);
	}
	return parts;
}

function orbitParts(presence: number, clock: MorphClock): OverlayPart[] {
	const grow = easeOutCubic(presence);
	const radius = 52 * easeOutBack(presence);
	const turn = clock.stateTime * 1e3 * 17e-4;
	return Array.from({ length: 5 }, (_, i) => {
		const angle = turn + (i * Math.PI * 2) / 5;
		const depth = Math.cos(angle);
		const near = 0.5 + 0.5 * clamp(depth, 0, 1);
		return disc(
			`orbit.${i}`,
			L + radius * Math.sin(angle),
			L - radius * 0.42 * Math.cos(angle),
			Math.max(12 * near * grow, 0.3),
			clamp((depth + 0.4) / 0.6, 0.18, 1) * grow,
		);
	});
}

function radarParts(presence: number, clock: MorphClock, coreRadius: number): OverlayPart[] {
	const grow = easeOutCubic(presence);
	return Array.from({ length: 3 }, (_, i) => {
		const t = fraction((clock.stateTime * 1e3) / 1300 + i / 3);
		return ring(`radar.${i}`, coreRadius + (104 - coreRadius) * t, 3.4 * (1 - t * 0.55), grow * (1 - t) * 0.9);
	});
}

function progressParts(presence: number, clock: MorphClock): OverlayPart[] {
	const grow = easeOutCubic(presence);
	const radius = 62 * easeOutBack(presence);
	const done = clamp(clamp((clock.shotTime * 1e3) / PROGRESS_MS, 0, 1) / 0.85, 0, 1);
	const track = ring("progress.track", radius, 5, grow * 0.16);
	return done <= 0
		? [track]
		: [
				track,
				{
					type: "ring",
					key: "progress.arc",
					cx: L,
					cy: L,
					r: radius,
					width: 5,
					opacity: grow,
					arc: { fraction: done, startDeg: -90 },
				},
			];
}

function gatherParts(presence: number, clock: MorphClock): OverlayPart[] {
	const grow = easeOutCubic(presence);
	const parts: OverlayPart[] = [];
	for (let i = 0; i < 5; i++) {
		const t = clamp(((clock.shotTime * 1e3) / GATHER_MS - i * 0.09) / 0.62, 0, 1);
		if (t >= 1) continue;
		const arrived = 1 - (1 - t) ** 3;
		const angle = i * 2.4 + t * 2.2;
		const distance = 96 * (1 - arrived);
		parts.push(
			disc(
				`gather.${i}`,
				L + distance * Math.cos(angle),
				L + distance * Math.sin(angle) * 0.8,
				9 * (0.5 + 0.5 * arrived) * grow,
				grow * clamp(t * 5, 0, 1) * (1 - arrived * 0.25),
			),
		);
	}
	return parts;
}

function waveParts(presence: number, clock: MorphClock): OverlayPart[] {
	const ms = clock.stateTime * 1e3;
	const parts: OverlayPart[] = [];
	for (const bar of WAVE_BARS) {
		const t = clamp((presence - Math.abs(bar) * 0.1) / (1 - Math.abs(bar) * 0.1), 0, 1);
		if (t <= 4e-3) continue;
		const spread = easeOutBack(t);
		const level = barLevel(ms, bar);
		const radius = (7 + 9 * clamp(level, 0.08, 1)) * easeOutCubic(t);
		const lift = 6 * clamp(level, 0, 1) * t;
		parts.push(disc(`wave.${bar}`, L + bar * 44 * spread, L - lift, radius, t));
	}
	return parts;
}

function sendParts(presence: number, clock: MorphClock): OverlayPart[] {
	const grow = easeOutCubic(presence);
	const phase = fraction((clock.stateTime * 1e3) / SEND_PERIOD);
	const flight = clamp((phase - 0.18) / 0.55, 0, 1);
	const travel = flight * flight * (0.4 + 0.6 * flight);
	const dx = 0.74;
	const dy = -0.62;
	const parts: OverlayPart[] = [];
	if (flight > 0 && flight < 1) {
		const distance = 108 * travel;
		parts.push(
			disc(
				"send.packet",
				L + dx * distance,
				L + dy * distance,
				10 * (1 - travel * 0.55) * grow,
				grow * (1 - travel * travel),
			),
		);
	}
	const trail = clamp((phase - 0.26) / 0.55, 0, 1);
	const trailTravel = trail * trail * (0.4 + 0.6 * trail);
	if (flight > 0 && trail > 0 && trail < 1) {
		const distance = 108 * trailTravel;
		parts.push(
			disc(
				"send.streak",
				L + dx * distance,
				L + dy * distance,
				5 * (1 - trailTravel * 0.6) * grow,
				grow * 0.3 * (1 - trailTravel),
			),
		);
	}
	const launch = clamp((phase - 0.18) / 0.3, 0, 1);
	if (launch > 0 && launch < 1)
		parts.push(ring("send.launch", 20 + 34 * easeOutCubic(launch), 2.8 * (1 - launch), grow * (1 - launch) * 0.8));
	return parts;
}

function receiveParts(presence: number, clock: MorphClock): OverlayPart[] {
	const grow = easeOutCubic(presence);
	const ms = clock.stateTime * 1e3;
	const angle = arrivalAngle(Math.floor(ms / RECEIVE_PERIOD));
	const phase = fraction(ms / RECEIVE_PERIOD);
	const flight = clamp(phase / 0.6, 0, 1);
	const arrived = 1 - (1 - flight) ** 3;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const distance = 108 * (1 - arrived);
	const parts: OverlayPart[] = [];
	if (flight < 1) {
		const curve = 18 * Math.sin(flight * Math.PI) * (1 - arrived * 0.7);
		parts.push(
			disc(
				"receive.packet",
				L + cos * distance - sin * curve,
				L + sin * distance + cos * curve,
				3.5 + 6.5 * arrived,
				grow * clamp(flight * 3.5, 0, 1) * (0.3 + 0.7 * arrived),
			),
		);
	}
	const absorb = clamp((phase - 0.58) / 0.32, 0, 1);
	if (absorb > 0 && absorb < 1)
		parts.push(ring("receive.absorb", 20 + 26 * easeOutCubic(absorb), 2.8 * (1 - absorb), grow * (1 - absorb) * 0.8));
	return parts;
}

function dockParts(presence: number, clock: MorphClock): OverlayPart[] {
	const grow = easeOutCubic(presence);
	const ms = clock.stateTime * 1e3;
	const parts: OverlayPart[] = [];
	for (let i = 0; i < 2; i++) {
		const t = clamp((clock.stateTime - (0.2 + i * 1.3)) / 0.9, 0, 1);
		if (t <= 0) continue;
		const arrived = 1 - (1 - t) ** 3;
		const angle = ms * 1e-3 * 1.1 + i * Math.PI;
		const toX = L + 42 * Math.sin(angle);
		const toY = L + 21 * Math.cos(angle) + Math.sin(ms * 3e-3 + i) * 2;
		const fromX = L - 120 + i * 30;
		const fromY = L + 95;
		parts.push(
			disc(
				`dock.${i}`,
				fromX + (toX - fromX) * arrived,
				fromY + (toY - fromY) * arrived,
				(7 + 3 * arrived) * grow,
				grow * clamp(t * 4, 0, 1),
			),
		);
	}
	return parts;
}

function pencilParts(presence: number, clock: MorphClock): OverlayPart[] {
	const ms = clock.stateTime * 1e3;
	const at = pencilAt(ms);
	const angle = ((at.rot - 90) * Math.PI) / 180;
	const ax = Math.cos(angle) * 68;
	const ay = Math.sin(angle) * 68;
	const x = L + (at.x + ax) * presence;
	const y = L + (at.y + at.wig * 0.15 + ay) * presence;
	const parts: OverlayPart[] = [
		shape(
			"pencil.shaft",
			PENCIL_SHAFT,
			`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(at.rot * presence).toFixed(1)}) scale(${easeOutCubic(presence).toFixed(3)}) translate(${-L} ${-L})`,
			clamp(presence * 1.6 - 0.3, 0, 1),
		),
	];
	const trail = inkTrail(ms);
	if (trail.length >= 2) parts.push(stroke("pencil.ink", smoothPath(trail), 6, clamp(presence * 1.2, 0, 1)));
	return parts;
}

function alertParts(presence: number, clock: MorphClock): OverlayPart[] {
	const seconds = clock.stateTime;
	const drop = easeOutCubic(clamp(presence * 1.1, 0, 1));
	const ringDown = Math.exp(-(seconds % 2.2) * 5.5);
	const shake = Math.sin(seconds * 42) * 2.2 * ringDown;
	return [
		shape(
			"bang.bar",
			ALERT_BAR,
			`translate(0 ${(-26 - (1 - drop) * 70).toFixed(1)}) rotate(${shake.toFixed(2)} ${L} ${(L - 74).toFixed(1)}) translate(${L} ${L}) scale(${clamp(presence * 1.2, 0, 1).toFixed(3)}) translate(${-L} ${-L})`,
			clamp(presence * 1.5 - 0.2, 0, 1),
		),
	];
}

function standbyParts(presence: number, clock: MorphClock): OverlayPart[] {
	const breath = 0.5 + 0.5 * Math.sin(clock.stateTime * 1e3 * 16e-4);
	return [disc("standby.halo", L, L, 26 + 7 * breath, easeOutCubic(presence) * (0.06 + 0.1 * breath))];
}

function partsFor(
	kind: MorphKind,
	presence: number,
	clock: MorphClock,
	coreRadius: number,
	isReduced: boolean,
): OverlayPart[] {
	switch (kind) {
		case "dots":
			return dotsParts(presence, clock, isReduced);
		case "orbit":
			return orbitParts(presence, clock);
		case "radar":
			return radarParts(presence, clock, coreRadius);
		case "progress":
			return progressParts(presence, clock);
		case "gather":
			return gatherParts(presence, clock);
		case "wave":
			return waveParts(presence, clock);
		case "send":
			return sendParts(presence, clock);
		case "receive":
			return receiveParts(presence, clock);
		case "dock":
			return dockParts(presence, clock);
		case "ball":
			return [];
		case "pencil":
			return pencilParts(presence, clock);
		case "bang":
			return alertParts(presence, clock);
		case "standby":
			return standbyParts(presence, clock);
	}
}

/** The shrunken body: how it is placed, and the ring outline it rounds toward. */
export interface Core {
	scale: number;
	dx: number;
	dy: number;
	rotation: number;
	opacity: number;
	round: number;
	ring: Vec2[];
}

export interface Overlay {
	core: Core;
	isFaceVisible: boolean;
	zoom: number;
	parts: OverlayPart[];
}

/** The overlay for a morph snapshot at a display size in CSS pixels. */
export function overlayFor(morph: MorphSnapshot, displaySize: number): Overlay {
	const { kind, isReducedMotion: isReduced } = morph;
	const amount = clamp(morph.amount, 0, 1);
	const swap = clamp(morph.swap, 0, 1);
	const outgoing = swap < 0.999 ? morph.outgoing : null;
	const share = (k: MorphKind) => (k === kind ? amount * swap : k === outgoing ? amount * (1 - swap) : 0);
	const clockFor = (k: MorphKind) => (k === kind ? morph.clock : morph.outgoingClock);
	const roundness = clamp(amount / ROUND_BY, 0, 1);
	const coreRing =
		kind !== "pencil" && outgoing !== "pencil"
			? CIRCLE
			: swap >= 0.999
				? ringFor(kind)
				: lerpRings(ringFor(outgoing), ringFor(kind), easeInOutCubic(swap));
	const coreRadius = kind
		? CORE_RADIUS[kind] * swap + (outgoing ? CORE_RADIUS[outgoing] : CORE_RADIUS[kind]) * (1 - swap)
		: 19;
	const dotsShare = share("dots");
	const hasDots = kind === "dots" || outgoing === "dots";
	const hop = hasDots ? dotHop(clockFor("dots"), 1, amount, isReduced) : STILL_DOT;
	let scale = hasDots ? 1 + (hop.pop - 1) * (dotsShare / Math.max(amount, 1e-3)) : 1;
	const receiveShare = share("receive");
	if (receiveShare > 4e-3) {
		const t = clamp((fraction((clockFor("receive").stateTime * 1e3) / RECEIVE_PERIOD) - 0.58) / 0.34, 0, 1);
		scale *= 1 + 0.11 * Math.sin(t * Math.PI) * receiveShare;
	}
	const sendShare = share("send");
	if (sendShare > 4e-3) {
		const t = fraction((clockFor("send").stateTime * 1e3) / SEND_PERIOD);
		const crouch = t < 0.18 ? -0.06 * Math.sin((t / 0.18) * Math.PI) : 0;
		const kick = t >= 0.18 && t < 0.42 ? 0.05 * Math.sin(((t - 0.18) / 0.24) * Math.PI) : 0;
		scale *= 1 + (crouch + kick) * sendShare;
	}
	const alertShare = share("bang");
	if (alertShare > 4e-3) scale *= 1 + 0.04 * Math.exp(-(clockFor("bang").stateTime % 2.2) * 5.5) * alertShare;
	let dx = 0;
	let dy = 0;
	let rotation = 0;
	const pencilShare = share("pencil");
	if (pencilShare > 4e-3) {
		const at = pencilAt(clockFor("pencil").stateTime * 1e3);
		dx += at.x * pencilShare;
		dy += (at.y + at.wig * 0.5) * pencilShare;
		rotation += at.rot * pencilShare;
	}
	if (alertShare > 4e-3) dy += 58 * alertShare;
	const ballShare = share("ball");
	if (ballShare > 4e-3) dy += ballHeight(clockFor("ball").stateTime) * ballShare;
	const coreScale = (coreRadius / L) * scale;
	const standbyShare = share("standby");
	const dim =
		standbyShare > 0 ? (0.28 + 0.2 * Math.sin(clockFor("standby").stateTime * 1e3 * 16e-4)) * standbyShare : 0;
	const core: Core = {
		scale: 1 - amount + coreScale * amount,
		dx: dx * amount,
		dy: -hop.lift * dotsShare + dy * amount,
		rotation: rotation * amount,
		opacity: (1 - (1 - hop.tone) * dotsShare) * (1 - dim),
		round: easeInOutCubic(roundness),
		ring: coreRing,
	};
	const smallFade = 1 - hermite(clamp((displaySize - 44) / 90, 0, 1));
	const zoomIn = kind == null ? 1 : OVERLAY_ZOOM[kind];
	const zoomOut = outgoing ? OVERLAY_ZOOM[outgoing] : zoomIn;
	const zoom = 1 + (zoomIn * swap + zoomOut * (1 - swap) - 1) * amount * smallFade;
	const parts: OverlayPart[] = [];
	for (const k of [outgoing, kind]) {
		if (k == null) continue;
		const s = share(k);
		if (s > 4e-3) parts.push(...partsFor(k, s, clockFor(k), coreRadius, isReduced));
	}
	return { core, isFaceVisible: amount < 0.5, zoom, parts: parts.filter((part) => part.opacity > 0) };
}
