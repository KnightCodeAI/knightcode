// Polygon union on a 1/1024 grid: merges a body's projected faces into one outline path.

const GRID = 1024;
const KEY_OFFSET = 2 ** 23;
const KEY_SPAN = 2 ** 25;
const EDGE_SPAN = 2 ** 26;

/** Interns grid points, numbering them in first-seen order. */
class PointIds {
	xs: number[] = [];
	ys: number[] = [];
	#ids = new Map<number, number>();
	id(x: number, y: number): number {
		const key = (x + KEY_OFFSET) * KEY_SPAN + (y + KEY_OFFSET);
		let id = this.#ids.get(key);
		if (id == null) {
			id = this.xs.length;
			this.xs.push(x);
			this.ys.push(y);
			this.#ids.set(key, id);
		}
		return id;
	}
}

interface Edge {
	ax: number;
	ay: number;
	bx: number;
	by: number;
	count: number;
}

const fmt = (value: number): string => String(Math.round(value * 100) / 100);

/** Flat [x, y, ...] polygons as one path. */
export function polygonsPath(polygons: number[][]): string {
	let d = "";
	for (const polygon of polygons) {
		d += `M${fmt(polygon[0]!)} ${fmt(polygon[1]!)}`;
		for (let i = 2; i < polygon.length; i += 2) d += ` ${fmt(polygon[i]!)} ${fmt(polygon[i + 1]!)}`;
		d += "Z";
	}
	return d;
}

/** The union of flat [x, y, ...] polygons, as a path. */
export function unionPath(polygons: number[][]): string {
	const edges = directedEdges(polygons);
	const vertices = splitPoints(edges);
	return tracePath(boundary(mergeEdges(edges.flatMap((edge) => splitEdge(edge, vertices)))));
}

/** Every polygon's edges, made counter-clockwise, with opposite edges cancelling. */
function directedEdges(polygons: number[][]): Edge[] {
	const ids = new PointIds();
	const counts = new Map<number, number>();
	const loop: number[] = [];
	const add = (points: number[]) => {
		const area = signedArea(points);
		if (area === 0) return;
		const count = points.length / 2;
		loop.length = 0;
		for (let i = 0; i < count; i++) {
			const k = area > 0 ? i : count - 1 - i;
			loop.push(ids.id(points[2 * k]!, points[2 * k + 1]!));
		}
		for (let i = 0; i < count; i++) {
			const a = loop[i]!;
			const b = loop[(i + 1) % count]!;
			if (a === b) continue;
			const reverse = b * EDGE_SPAN + a;
			const existing = counts.get(reverse) ?? 0;
			if (existing > 1) counts.set(reverse, existing - 1);
			else if (existing === 1) counts.delete(reverse);
			else counts.set(a * EDGE_SPAN + b, (counts.get(a * EDGE_SPAN + b) ?? 0) + 1);
		}
	};
	for (const polygon of polygons) {
		const snapped = polygon.map((v) => Math.round(v * GRID));
		const halves = snapped.length === 8 ? splitBowtie(snapped) : null;
		if (halves == null) add(snapped);
		else for (const half of halves) add(half);
	}
	const { xs, ys } = ids;
	return [...counts].map(([key, count]) => {
		const a = Math.floor(key / EDGE_SPAN);
		const b = key - a * EDGE_SPAN;
		return { ax: xs[a]!, ay: ys[a]!, bx: xs[b]!, by: ys[b]!, count };
	});
}

/** Every endpoint and crossing, sorted by x. */
function splitPoints(edges: Edge[]): { x: number; y: number }[] {
	const ids = new PointIds();
	for (const e of edges) {
		ids.id(e.ax, e.ay);
		ids.id(e.bx, e.by);
	}
	const order = edges.map((_, i) => i).sort((a, b) => minX(edges[a]!) - minX(edges[b]!));
	order.forEach((index, position) => {
		const a = edges[index]!;
		const right = Math.max(a.ax, a.bx);
		for (let k = position + 1; k < order.length; k++) {
			const b = edges[order[k]!]!;
			if (minX(b) > right) break;
			if (Math.min(b.ay, b.by) > Math.max(a.ay, a.by) || Math.max(b.ay, b.by) < Math.min(a.ay, a.by)) continue;
			const sideA = Math.sign(cross(a.ax, a.ay, a.bx, a.by, b.ax, b.ay));
			const sideB = Math.sign(cross(a.ax, a.ay, a.bx, a.by, b.bx, b.by));
			const startSide = cross(b.ax, b.ay, b.bx, b.by, a.ax, a.ay);
			const endSide = cross(b.ax, b.ay, b.bx, b.by, a.bx, a.by);
			if (sideA * sideB >= 0 || Math.sign(startSide) * Math.sign(endSide) >= 0) continue;
			const t = startSide / (startSide - endSide);
			ids.id(Math.round(a.ax + (a.bx - a.ax) * t), Math.round(a.ay + (a.by - a.ay) * t));
		}
	});
	const { xs, ys } = ids;
	return xs.map((x, i) => ({ x, y: ys[i]! })).sort((a, b) => a.x - b.x);
}

/** Cuts an edge at every split point lying on it. */
function splitEdge(edge: Edge, points: { x: number; y: number }[]): Edge[] {
	const dx = edge.bx - edge.ax;
	const dy = edge.by - edge.ay;
	const span = Math.abs(dx) + Math.abs(dy);
	const low = Math.min(edge.ay, edge.by) - 0.5;
	const high = Math.max(edge.ay, edge.by) + 0.5;
	const right = Math.max(edge.ax, edge.bx) + 0.5;
	const on: { t: number; x: number; y: number }[] = [];
	for (
		let i = firstAtOrAfter(points, Math.min(edge.ax, edge.bx) - 0.5);
		i < points.length && points[i]!.x <= right;
		i++
	) {
		const { x, y } = points[i]!;
		if (y < low || y > high || 2 * Math.abs(cross(edge.ax, edge.ay, edge.bx, edge.by, x, y)) > span) continue;
		on.push({ t: ((x - edge.ax) * dx + (y - edge.ay) * dy) / (dx * dx + dy * dy), x, y });
	}
	on.sort((a, b) => a.t - b.t);
	const pieces: Edge[] = [];
	for (let i = 1; i < on.length; i++) {
		const a = on[i - 1]!;
		const b = on[i]!;
		if (a.x !== b.x || a.y !== b.y) pieces.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, count: edge.count });
	}
	return pieces;
}

function firstAtOrAfter(points: { x: number }[], x: number): number {
	let low = 0;
	let high = points.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (points[mid]!.x < x) low = mid + 1;
		else high = mid;
	}
	return low;
}

/** Sums the windings of coincident edges. */
function mergeEdges(edges: Edge[]): Edge[] {
	const ids = new PointIds();
	const counts = new Map<number, number>();
	for (const e of edges) {
		const a = ids.id(e.ax, e.ay);
		const b = ids.id(e.bx, e.by);
		const key = Math.min(a, b) * EDGE_SPAN + Math.max(a, b);
		counts.set(key, (counts.get(key) ?? 0) + (a < b ? e.count : -e.count));
	}
	const { xs, ys } = ids;
	const merged: Edge[] = [];
	for (const [key, count] of counts) {
		if (count === 0) continue;
		const a = Math.floor(key / EDGE_SPAN);
		const b = key - a * EDGE_SPAN;
		merged.push({ ax: xs[a]!, ay: ys[a]!, bx: xs[b]!, by: ys[b]!, count });
	}
	return merged;
}

/** Keeps the edges between filled and empty, oriented with the fill on the left. */
function boundary(edges: Edge[]): Edge[] {
	const kept: Edge[] = [];
	for (const e of edges) {
		const mx = e.ax + e.bx;
		const my = e.ay + e.by;
		let winding = 0;
		for (const other of edges) {
			if (other === e) continue;
			const ay = 2 * other.ay;
			const by = 2 * other.by;
			if (ay <= my) {
				if (by > my && cross(2 * other.ax, ay, 2 * other.bx, by, mx, my) > 0) winding += other.count;
			} else if (by <= my && cross(2 * other.ax, ay, 2 * other.bx, by, mx, my) < 0) winding -= other.count;
		}
		const left = e.ay < e.by || (e.ay === e.by && e.ax > e.bx) ? winding + e.count : winding;
		const right = left - e.count;
		if ((left !== 0) !== (right !== 0))
			kept.push(left === 0 ? { ax: e.bx, ay: e.by, bx: e.ax, by: e.ay, count: 1 } : { ...e, count: 1 });
	}
	return kept;
}

/** Chains boundary edges into closed loops. */
function tracePath(edges: Edge[]): string {
	const ids = new PointIds();
	const next: number[][] = [];
	for (const e of edges) {
		const a = ids.id(e.ax, e.ay);
		const b = ids.id(e.bx, e.by);
		while (next.length <= Math.max(a, b)) next.push([]);
		for (let i = 0; i < Math.abs(e.count); i++) {
			if (e.count > 0) next[a]!.push(b);
			else next[b]!.push(a);
		}
	}
	const { xs, ys } = ids;
	let d = "";
	next.forEach((outgoing, start) => {
		while (outgoing.length > 0) {
			d += `M${fmt(xs[start]! / GRID)} ${fmt(ys[start]! / GRID)}`;
			let at = outgoing.pop();
			while (at != null && at !== start) {
				d += ` ${fmt(xs[at]! / GRID)} ${fmt(ys[at]! / GRID)}`;
				at = next[at]!.pop();
			}
			d += "Z";
		}
	});
	return d;
}

/** Splits a self-crossing quad into its two triangles. */
function splitBowtie(quad: number[]): number[][] | null {
	const [x0, y0, x1, y1, x2, y2, x3, y3] = quad as [number, number, number, number, number, number, number, number];
	const a = crossing(x0, y0, x1, y1, x2, y2, x3, y3);
	if (a != null)
		return [
			[x0, y0, a[0], a[1], x3, y3],
			[a[0], a[1], x1, y1, x2, y2],
		];
	const b = crossing(x1, y1, x2, y2, x3, y3, x0, y0);
	return b == null
		? null
		: [
				[x1, y1, b[0], b[1], x0, y0],
				[b[0], b[1], x2, y2, x3, y3],
			];
}

function crossing(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	dx: number,
	dy: number,
): [number, number] | null {
	const sideC = Math.sign(cross(ax, ay, bx, by, cx, cy));
	const sideD = Math.sign(cross(ax, ay, bx, by, dx, dy));
	const startSide = cross(cx, cy, dx, dy, ax, ay);
	const endSide = cross(cx, cy, dx, dy, bx, by);
	if (!(sideC * sideD < 0 && Math.sign(startSide) * Math.sign(endSide) < 0)) return null;
	const t = startSide / (startSide - endSide);
	return [Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t)];
}

const cross = (ax: number, ay: number, bx: number, by: number, px: number, py: number): number =>
	(bx - ax) * (py - ay) - (by - ay) * (px - ax);

function signedArea(points: number[]): number {
	let sum = 0;
	for (let i = 0; i < points.length; i += 2) {
		const j = (i + 2) % points.length;
		sum += points[i]! * points[j + 1]! - points[j]! * points[i + 1]!;
	}
	return sum;
}

const minX = (e: Edge): number => Math.min(e.ax, e.bx);
