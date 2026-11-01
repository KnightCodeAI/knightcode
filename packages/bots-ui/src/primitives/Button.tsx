// Text buttons: primary (inverse fill), secondary (dialog actions) and subtle (settings rows).
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx.ts";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "subtle";
	/** `sm` is the 13 px settings size; `md` the 14 px card and dialog size. */
	size?: "sm" | "md";
}

/** A pill button with the measured hover wash and colour transitions. */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
	return (
		<button
			type={type}
			className={cx("kb-button", "kb-hover-wash", `kb-button--${variant}`, `kb-button--${size}`, className)}
			{...props}
		/>
	);
}
