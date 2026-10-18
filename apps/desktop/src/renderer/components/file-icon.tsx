import { File } from "lucide-react";

/** Language badges for the common extensions, as Codex marks files in its Changes pane; a plain file otherwise. */
const BADGES: Record<string, { label: string; bg: string; fg: string }> = {
	js: { label: "JS", bg: "#2b2a1d", fg: "#f0db4f" },
	mjs: { label: "JS", bg: "#2b2a1d", fg: "#f0db4f" },
	cjs: { label: "JS", bg: "#2b2a1d", fg: "#f0db4f" },
	jsx: { label: "JS", bg: "#2b2a1d", fg: "#f0db4f" },
	ts: { label: "TS", bg: "#1b2633", fg: "#4a9eff" },
	mts: { label: "TS", bg: "#1b2633", fg: "#4a9eff" },
	tsx: { label: "TS", bg: "#1b2633", fg: "#4a9eff" },
	py: { label: "PY", bg: "#1d2633", fg: "#5a9fd4" },
	rs: { label: "RS", bg: "#2e2220", fg: "#e57a52" },
	go: { label: "GO", bg: "#1b2b30", fg: "#4dc0d8" },
	json: { label: "{}", bg: "#2b2a1d", fg: "#d6c25e" },
	md: { label: "MD", bg: "#22262b", fg: "#9fb3c8" },
	css: { label: "#", bg: "#1d2433", fg: "#5d8ff0" },
	html: { label: "<>", bg: "#2e2220", fg: "#e8774a" },
};

export function FileIcon({ path }: { path: string }) {
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	const badge = path.includes(".") ? BADGES[extension] : undefined;
	if (!badge) return <File size={16} strokeWidth={1.75} className="shrink-0 text-desc" />;
	return (
		<span
			aria-hidden="true"
			style={{ background: badge.bg, color: badge.fg }}
			className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-[7.5px] leading-none font-bold tracking-tight"
		>
			{badge.label}
		</span>
	);
}
