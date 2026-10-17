export function duration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function relativeTime(iso: string, now = Date.now()): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return "";
	const s = Math.round((now - t) / 1000);
	if (s < 60) return "now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h`;
	if (s < 604_800) return `${Math.floor(s / 86_400)}d`;
	return `${Math.floor(s / 604_800)}w`;
}

export const basename = (path: string) =>
	path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.pop() || path;

export function samePath(a: string, b: string): boolean {
	const norm = (p: string) => p.replace(/[\\/]+$/, "").replaceAll("\\", "/");
	return window.knightcode.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

export const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
