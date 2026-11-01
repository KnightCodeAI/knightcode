// A small pill label: counts, states and markers such as "Needs you".
import type { HTMLAttributes } from "react";
import { cx } from "./cx.ts";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
	tone?: "neutral" | "accent";
}

/** A pill label. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
	return <span className={cx("kb-badge", tone === "accent" && "kb-badge--accent", className)} {...props} />;
}
