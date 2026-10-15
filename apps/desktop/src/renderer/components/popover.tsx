import { Check } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { matches } from "../keys.ts";

/** A button that opens a menu above or below it; clicking outside or Escape closes it. Styled after Codex's. */
export function Popover({
	trigger,
	children,
	align = "left",
	side = "top",
	className = "",
}: {
	trigger: (open: boolean) => ReactNode;
	children: (close: () => void) => ReactNode;
	align?: "left" | "right";
	side?: "top" | "bottom";
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (matches(event, "desktop.picker.dismiss")) {
				event.stopPropagation();
				setOpen(false);
			}
		};
		window.addEventListener("mousedown", onDown);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("keydown", onKey, true);
		};
	}, [open]);
	return (
		<div ref={ref} className="relative">
			<div onClick={() => setOpen(!open)}>{trigger(open)}</div>
			{open ? (
				<div
					className={`kc-menu absolute z-30 min-w-56 ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${align === "left" ? "left-0" : "right-0"} ${className}`}
				>
					{children(() => setOpen(false))}
				</div>
			) : null}
		</div>
	);
}

/** A menu's caption, as Codex heads its menus ("Select model", "How should … be approved?"). */
export function MenuCaption({ children }: { children: ReactNode }) {
	return <div className="px-2 pt-1 pb-1.5 text-[13px] leading-4 text-desc">{children}</div>;
}

export function MenuItem({
	children,
	onClick,
	checked,
	danger,
	icon,
	description,
}: {
	children: ReactNode;
	onClick: () => void;
	checked?: boolean;
	/** Drawn in the caution colour, title and description both, as Codex draws Full access. */
	danger?: boolean;
	icon?: ReactNode;
	description?: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			data-checked={checked || undefined}
			className={`kc-row ${danger ? "text-caution" : "text-ink"}`}
		>
			{icon ? <span className={`flex shrink-0 ${description ? "self-start pt-[3px]" : ""}`}>{icon}</span> : null}
			<span className="min-w-0 flex-1">
				<span className="block truncate">{children}</span>
				{description ? (
					<span className={`block text-[12px] leading-[14px] ${danger ? "" : "text-desc"}`}>{description}</span>
				) : null}
			</span>
			{checked ? <Check size={15} className="ml-2 shrink-0" /> : null}
		</button>
	);
}
