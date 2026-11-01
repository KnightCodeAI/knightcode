// Round icon-only buttons with a tooltip naming them.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";
import { Tooltip } from "./Tooltip.tsx";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	/** The accessible name, also shown as the tooltip. */
	label: string;
	icon: ReactNode;
	/** `raised`: a filled circle with a hairline edge (sidebar, panes); `ghost`: bare (dialog close). */
	variant?: "raised" | "ghost";
	/** Diameter in pixels: 36 (sidebar), 32 (dialog close) or 28 (compact). */
	size?: 28 | 32 | 36;
	/** Show the tooltip on hover. Default true. */
	tooltip?: boolean;
}

/** An icon button. Its name is required, so it is never unlabelled. */
export function IconButton({
	label,
	icon,
	variant = "raised",
	size = 36,
	tooltip = true,
	className,
	type = "button",
	style,
	...props
}: IconButtonProps) {
	const button = (
		<button
			type={type}
			aria-label={label}
			className={cx("kb-icon-button", variant === "raised" && "kb-hover-wash", `kb-icon-button--${variant}`, className)}
			style={{ width: size, height: size, ...style }}
			{...props}
		>
			{icon}
		</button>
	);
	return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
