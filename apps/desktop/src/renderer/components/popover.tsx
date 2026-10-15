import { matches } from "../keys.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * A button that opens a panel; clicking outside or Escape closes it. `anchored` places the panel against the
 * nearest positioned ancestor instead of the button, as the composer's menus open above the whole composer.
 */
export function Popover({
	trigger,
	children,
	align = "left",
	side = "top",
	anchored = false,
	className = "",
}: {
	trigger: (open: boolean) => ReactNode;
	children: (close: () => void) => ReactNode;
	align?: "left" | "right";
	side?: "top" | "bottom";
	anchored?: boolean;
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
		<div ref={ref} className={anchored ? undefined : "relative"}>
			<div onClick={() => setOpen(!open)}>{trigger(open)}</div>
			{open ? (
				<div
					className={`absolute z-30 min-w-56 rounded-xl border border-line-strong bg-elevated p-1 shadow-2xl ${side === "top" ? "bottom-full mb-2" : "top-full mt-2"} ${align === "left" ? "left-0" : "right-0"} ${className}`}
				>
					{children(() => setOpen(false))}
				</div>
			) : null}
		</div>
	);
}

export function MenuItem({
	children,
	onClick,
	checked,
	danger,
}: {
	children: ReactNode;
	onClick: () => void;
	checked?: boolean;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-hover ${danger ? "text-danger" : ""}`}
		>
			<span className="min-w-0 flex-1">{children}</span>
			{checked ? <span className="text-accent">✓</span> : null}
		</button>
	);
}
