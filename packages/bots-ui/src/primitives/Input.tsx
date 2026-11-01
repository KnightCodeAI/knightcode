// Single-line and multi-line text fields.
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx.ts";

/** A 36 px text field. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
	{ className, ...props },
	ref,
) {
	return <input ref={ref} className={cx("kb-input", className)} {...props} />;
});

/** A text area with the same edge and type as `Input`. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
	{ className, ...props },
	ref,
) {
	return <textarea ref={ref} className={cx("kb-textarea", className)} {...props} />;
});
