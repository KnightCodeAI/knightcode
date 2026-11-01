// A pulsing placeholder while content loads.
import type { CSSProperties } from "react";
import { cx } from "./cx.ts";

export interface SkeletonProps {
	width?: CSSProperties["width"];
	height?: CSSProperties["height"];
	radius?: CSSProperties["borderRadius"];
	className?: string;
}

/** A placeholder block, hidden from assistive tech. */
export function Skeleton({ width = "100%", height = 16, radius, className }: SkeletonProps) {
	return (
		<span
			aria-hidden
			className={cx("kb-skeleton", className)}
			style={{ display: "block", width, height, borderRadius: radius }}
		/>
	);
}
