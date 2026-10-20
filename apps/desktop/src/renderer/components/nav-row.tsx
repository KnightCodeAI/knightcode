/**
 * A navigation row (styles.css, .kc-nav-row), as Codex draws its sidebar and settings rows: a 24px icon slot (or an
 * empty one, so a row lines up under its parent's label), a label that fades out when it is too long and scrolls to
 * its end while the row is hovered, a status at its end, and actions that take the status's place while the row is
 * hovered or focused. It is a `role="button"` div so the actions can be real buttons inside it; Enter activates it.
 * Other props reach the div, so a row can be a Radix trigger (a hover card's).
 */

import type React from "react";
import { type ComponentProps, type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { matches } from "../keys.ts";

/**
 * Codex's marquee timing for a label `distance` px too long: a 0.35s rest, then 2em a second eased by
 * cubic-bezier(.49, .6, .7, 1), sampled at 33 points into a linear() curve.
 */
function marqueeStyle(distance: number, fontSize: number): CSSProperties {
	const rest = 0.35;
	const scroll = distance / (fontSize * 2);
	const total = rest + scroll;
	const stop = (progress: number, time: number) => `${progress.toFixed(4)} ${((time / total) * 100).toFixed(4)}%`;
	const stops = [stop(0, 0)];
	for (let i = 0; i <= 32; i++) {
		const t = i / 32;
		const a = 3 * (1 - t) ** 2 * t;
		const b = 3 * (1 - t) * t ** 2;
		stops.push(stop(a * 0.6 + b + t ** 3, rest + scroll * (a * 0.49 + b * 0.7 + t ** 3)));
	}
	return {
		"--kc-marquee-duration": `${total.toFixed(3)}s`,
		"--kc-marquee-distance": `${distance}px`,
		"--kc-marquee-timing": `linear(${stops.join(", ")})`,
	} as CSSProperties;
}

/**
 * A label that fades out when it is too long for its row and, while the row is hovered, scrolls to its end and stays
 * there (styles.css, .kc-marquee). The distance follows the row's width, which the actions narrow on hover.
 */
function Marquee({ children }: { children: ReactNode }) {
	const viewport = useRef<HTMLSpanElement>(null);
	const content = useRef<HTMLSpanElement>(null);
	const [style, setStyle] = useState<CSSProperties>();
	useLayoutEffect(() => {
		const outer = viewport.current!;
		const inner = content.current!;
		const observer = new ResizeObserver(() => {
			const distance = inner.getBoundingClientRect().width - outer.getBoundingClientRect().width;
			setStyle(distance < 1 ? undefined : marqueeStyle(distance, Number.parseFloat(getComputedStyle(inner).fontSize)));
		});
		observer.observe(outer);
		observer.observe(inner);
		return () => observer.disconnect();
	}, []);
	return (
		<span ref={viewport} className="kc-marquee" data-overflowing={style ? true : undefined}>
			<span className="kc-marquee-clip" style={style}>
				<span className="kc-marquee-track">
					<span ref={content}>{children}</span>
				</span>
			</span>
		</span>
	);
}

export function NavRow({
	icon,
	inset,
	label,
	status,
	actions,
	current,
	selected,
	expanded,
	onActivate,
	onContextMenu,
	className = "",
	...props
}: Omit<ComponentProps<"div">, "onClick" | "children"> & {
	icon?: ReactNode;
	/** An empty icon slot, so the label lines up with a parent row's. */
	inset?: boolean;
	label: ReactNode;
	status?: ReactNode;
	actions?: ReactNode;
	current?: boolean;
	/** Part of a multi-row selection (the sidebar's Ctrl- and Shift-click). */
	selected?: boolean;
	/** For a row that opens and closes a group (a project). */
	expanded?: boolean;
	/** A click (with its modifier keys) or Enter. */
	onActivate: (event: React.MouseEvent | React.KeyboardEvent) => void;
	onContextMenu?: (event: React.MouseEvent) => void;
	className?: string;
}) {
	return (
		<div
			{...props}
			role="button"
			tabIndex={0}
			aria-current={current ? "page" : undefined}
			data-selected={selected || undefined}
			aria-expanded={expanded}
			onClick={onActivate}
			onContextMenu={onContextMenu}
			onKeyDown={(event) => {
				// Enter on a nested action bubbles here; that button's own click handles it.
				if (event.target !== event.currentTarget || !matches(event, "desktop.item.activate")) return;
				event.preventDefault();
				onActivate(event);
			}}
			className={`kc-nav-row group/row ${className}`}
		>
			{icon || inset ? <span className="kc-nav-row-icon">{icon}</span> : null}
			<Marquee>{label}</Marquee>
			{status ? <span className="kc-nav-row-status">{status}</span> : null}
			{actions ? (
				// Clicks on the actions are theirs, not the row's.
				<span className="kc-nav-row-actions" onClick={(event) => event.stopPropagation()}>
					{actions}
				</span>
			) : null}
		</div>
	);
}
