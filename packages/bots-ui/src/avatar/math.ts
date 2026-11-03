// Shared numeric helpers: springs, easing curves, quaternions and 3x3 rotations.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** A unit quaternion as [w, x, y, z]. */
export type Quat = [number, number, number, number];
/** A row-major 3x3 matrix. */
export type Mat3 = number[];
/** A cubic-bezier timing curve [x1, y1, x2, y2]. */
export type Curve = readonly [number, number, number, number] | readonly number[];

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

// ─── Springs ────────────────────────────────────────────────────────────────

export interface Spring {
	x: number;
	v: number;
	t: number;
}

export const spring = (value: number): Spring => ({ x: value, v: 0, t: value });

/** One semi-implicit Euler step of a damped spring pulling `x` toward `t`. */
export function stepSpring(s: Spring, omega: number, zeta: number, dt: number): void {
	s.v += (-2 * zeta * omega * s.v - omega * omega * (s.x - s.t)) * dt;
	s.x += s.v * dt;
	if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
		s.x = s.t;
		s.v = 0;
	}
}

const SPRING_STEP = 1 / 120;
/** How many fixed spring steps cover `dt`. */
export const springSteps = (dt: number): number => Math.max(1, Math.ceil(dt / SPRING_STEP));

// ─── Easing ─────────────────────────────────────────────────────────────────

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeOutBack = (t: number): number => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
/** Smoothstep without clamping. */
export const hermite = (t: number): number => t * t * (3 - 2 * t);
/** Smoothstep of a value clamped to [0, 1]. */
export function smoothstep01(value: number): number {
	const t = Math.min(1, Math.max(0, value));
	return t * t * (3 - 2 * t);
}
/** Smoothstep between two edges. */
export function smoothstep(low: number, high: number, value: number): number {
	const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
	return t * t * (3 - 2 * t);
}

export const EASE_STANDARD: Curve = [0.42, 0, 0.58, 1];
export const EASE_FACE_MORPH: Curve = [0.4, 0.06, 0.18, 1];

function bezierAt(t: number, p1: number, p2: number): number {
	const u = 1 - t;
	return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierSlope(t: number, p1: number, p2: number): number {
	const u = 1 - t;
	return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** Evaluates a CSS-style cubic-bezier timing curve at progress `x`. */
export function cubicBezier(x: number, curve: Curve): number {
	const [x1, y1, x2, y2] = curve as [number, number, number, number];
	let t = x;
	for (let i = 0; i < 8; i++) {
		const error = bezierAt(t, x1, x2) - x;
		const slope = bezierSlope(t, x1, x2);
		if (Math.abs(error) < 1e-6 || Math.abs(slope) < 1e-6) break;
		t = Math.min(1, Math.max(0, t - error / slope));
	}
	return bezierAt(t, y1, y2);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

/** Rounds to two decimals, the precision of every emitted path. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;
/** `round2` as text. */
export const fmt2 = (value: number): string => String(Math.round(value * 100) / 100);
/** Rounds to `digits` decimals, as text. */
export function fmt(value: number, digits = 2): string {
	const scale = 10 ** digits;
	return String(Math.round(value * scale) / scale);
}

// ─── Random and hashing ─────────────────────────────────────────────────────

/** A small deterministic generator returning floats in [0, 1). */
export function random(seed: number): () => number {
	let state = seed | 0;
	return () => {
		state = (state + 1831565813) | 0;
		let x = Math.imul(state ^ (state >>> 15), state | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

/** FNV-1a over UTF-16 code units. */
export function hashSeed(text: string): number {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
	return hash >>> 0;
}

// ─── Rotations ──────────────────────────────────────────────────────────────

export function quatMultiply(a: Quat, b: Quat): Quat {
	return [
		a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
		a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
		a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
		a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
	];
}

export function quatAxisAngle(axis: Vec3, angle: number): Quat {
	const s = Math.sin(angle / 2);
	return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

function quatNormalize(q: Quat): Quat {
	const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** The shortest rotation taking unit vector `a` onto unit vector `b`. */
export function quatBetween(a: Vec3, b: Vec3): Quat {
	return quatNormalize([
		1 + (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]),
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	]);
}

export function quatToMatrix(q: Quat): Mat3 {
	const [w, x, y, z] = q;
	return [
		1 - 2 * (y * y + z * z),
		2 * (x * y - w * z),
		2 * (x * z + w * y),
		2 * (x * y + w * z),
		1 - 2 * (x * x + z * z),
		2 * (y * z - w * x),
		2 * (x * z - w * y),
		2 * (y * z + w * x),
		1 - 2 * (x * x + y * y),
	];
}

/** Rotation about X, then Y, then Z (radians). */
export function quatFromEuler(x: number, y: number, z: number): Quat {
	return quatMultiply(
		quatAxisAngle([0, 0, 1], z),
		quatMultiply(quatAxisAngle([0, 1, 0], y), quatAxisAngle([1, 0, 0], x)),
	);
}

/** The X, Y, Z angles (radians) of a rotation matrix built by `quatFromEuler`. */
export function matrixToEuler(m: Mat3): Vec3 {
	const m00 = m[0]!;
	const m10 = m[3]!;
	const m12 = m[5]!;
	const m11 = m[4]!;
	const m20 = m[6]!;
	const m21 = m[7]!;
	const m22 = m[8]!;
	const sinY = Math.max(-1, Math.min(1, -m20));
	const y = Math.asin(sinY);
	return Math.abs(sinY) > 0.999999 ? [Math.atan2(-m12, m11), y, 0] : [Math.atan2(m21, m22), y, Math.atan2(m10, m00)];
}

export const quatToEuler = (q: Quat): Vec3 => matrixToEuler(quatToMatrix(q));

export function mat3Apply(m: Mat3, v: Vec3): Vec3 {
	return [
		m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
		m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
		m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
	];
}

function normalize3(v: Vec3): Vec3 {
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / length, v[1] / length, v[2] / length];
}

// ─── The eye frame ──────────────────────────────────────────────────────────
// The two eyes sit on the sphere as capsules, measured as start, end and surface normal. Everything below is derived
// once from those measurements: the rest rotation that faces them forward, and each eye's local frame.

/** Half the eye-to-eye angle on the unit sphere, in radians. */
export const EYE_HALF_WIDTH = 0.1305;

const EYE_CAPSULES: readonly { A: Vec3; B: Vec3; N: Vec3 }[] = [
	{ A: [0.01722, 0.45638, 0.88962], B: [0.186, 0.20949, 0.95996], N: [0.82924, 0.4906, -0.26773] },
	{ A: [0.48863, 0.67924, 0.54762], B: [0.65674, 0.43195, 0.61815], N: [0.60389, 0.18972, -0.77416] },
];

const FACE_DIRECTION = (() => {
	let sum: Vec3 = [0, 0, 0];
	for (const { A, B } of EYE_CAPSULES) {
		const middle = normalize3([A[0] + B[0], A[1] + B[1], A[2] + B[2]]);
		sum = [sum[0] + middle[0], sum[1] + middle[1], sum[2] + middle[2]];
	}
	return normalize3(sum);
})();

/** Turns the measured face forward (+Z) with the eyes level. */
const FACE_FORWARD = (() => {
	const toward = quatBetween(FACE_DIRECTION, [0, 0, 1]);
	const matrix = quatToMatrix(toward);
	let dx = 0;
	let dy = 0;
	for (const { A, B } of EYE_CAPSULES) {
		const along = mat3Apply(matrix, [B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
		dx += along[0];
		dy += along[1];
	}
	const roll = ((((Math.PI / 2 - Math.atan2(dy, dx) + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
	return quatMultiply(quatAxisAngle([0, 0, 1], roll), toward);
})();

const FORWARD_CAPSULES = (() => {
	const matrix = quatToMatrix(FACE_FORWARD);
	return EYE_CAPSULES.map(({ A, B, N }) => ({
		A: mat3Apply(matrix, A),
		B: mat3Apply(matrix, B),
		N: mat3Apply(matrix, N),
	}));
})();

/** The rest rotation: the inverse of `FACE_FORWARD`, which shows the face turned slightly as drawn. */
export const REST_ROTATION: Quat = [FACE_FORWARD[0], -FACE_FORWARD[1], -FACE_FORWARD[2], -FACE_FORWARD[3]];

export interface EyeFrame {
	/** The eye's centre direction. */
	M: Vec3;
	/** Its long axis, tangent to the sphere. */
	T: Vec3;
	/** Its short axis. */
	C: Vec3;
}

/** Each eye's local frame on the forward-facing sphere, left then right. */
export const EYE_FRAMES: readonly [EyeFrame, EyeFrame] = (() => {
	const frame = ({ A, B }: { A: Vec3; B: Vec3 }): EyeFrame => {
		const M = normalize3([A[0] + B[0], A[1] + B[1], A[2] + B[2]]);
		const along = B[0] * M[0] + B[1] * M[1] + B[2] * M[2];
		let T = normalize3([B[0] - along * M[0], B[1] - along * M[1], B[2] - along * M[2]]);
		if (T[1] < 0) T = [-T[0], -T[1], -T[2]];
		let C: Vec3 = [M[1] * T[2] - M[2] * T[1], M[2] * T[0] - M[0] * T[2], M[0] * T[1] - M[1] * T[0]];
		if (C[0] * M[0] < 0) C = [-C[0], -C[1], -C[2]];
		return { M, T, C };
	};
	const [left, right] = FORWARD_CAPSULES;
	if (left == null || right == null) throw new Error("The eye frame needs exactly two capsules");
	return [frame(left), frame(right)];
})();
