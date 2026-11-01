// A raised surface with the measured card radius and edge.
import type { HTMLAttributes } from "react";
import { cx } from "./cx.ts";

/** A card container; layout inside is the caller's. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
	return <section className={cx("kb-card", className)} {...props} />;
}
