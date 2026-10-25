/**
 * Buttons, after Codex's (styles.css, .kc-button): a variant (ghost, solid, soft, outline, surface, field, accent), a
 * colour (primary, secondary, danger) and a size on Codex's control scale (20px 3xs to 40px 2xl; md is 28px).
 * `uniform` makes a square icon button, `pill` rounds it fully, `squircle` draws Codex's superellipse corners. Other
 * props pass through, so a button can be a Radix trigger (`asChild`) or carry its own aria attributes.
 */

import type { ComponentProps, ReactNode } from "react";
import { Tooltip } from "./tooltip.tsx";

export type ButtonSize = "3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

export type ButtonProps = Omit<ComponentProps<"button">, "color"> & {
	variant?: "ghost" | "solid" | "soft" | "outline" | "surface" | "field" | "accent";
	color?: "primary" | "secondary" | "danger";
	size?: ButtonSize;
	uniform?: boolean;
	pill?: boolean;
	squircle?: boolean;
	block?: boolean;
	/** A ghost that brightens to full strength on hover, as Codex's title bar and rail buttons do. */
	strong?: boolean;
	/** A toolbar toggle that turns Codex's blue while `aria-pressed`. */
	toggle?: boolean;
	/** Codex's toolbar control (settings' buttons and selects): 12.5px squircle corners, 8px in, 18px lines. */
	toolbar?: boolean;
};

const flag = (on: boolean | undefined) => (on ? "" : undefined);

export function Button({
	variant = "ghost",
	color = "primary",
	size = "md",
	uniform,
	pill,
	squircle,
	block,
	strong,
	toggle,
	toolbar,
	className = "",
	type = "button",
	...props
}: ButtonProps) {
	return (
		<button
			type={type}
			data-variant={variant}
			data-color={color}
			data-size={size}
			data-uniform={flag(uniform)}
			data-pill={flag(pill)}
			data-squircle={flag(squircle || toolbar)}
			data-block={flag(block)}
			data-strong={flag(strong)}
			data-toggle={flag(toggle)}
			data-toolbar={flag(toolbar)}
			className={`kc-button ${className}`}
			{...props}
		/>
	);
}

/**
 * An icon-only button: a secondary ghost, square, with Codex's squircle corners unless `round`. The label is its
 * accessible name and its tooltip.
 */
export function IconButton({
	label,
	round,
	children,
	...props
}: Omit<ButtonProps, "children" | "uniform" | "variant" | "color"> & {
	label: string;
	round?: boolean;
	children: ReactNode;
}) {
	return (
		<Tooltip content={label}>
			<Button variant="ghost" color="secondary" uniform pill={round} squircle={!round} aria-label={label} {...props}>
				{children}
			</Button>
		</Tooltip>
	);
}

/**
 * A choice of a few values as a row of pills, as Codex's Follow-up behavior: the chosen one lit and at full strength,
 * the others secondary ghosts (24px, 8px in).
 */
export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	label: string;
}) {
	return (
		<div role="group" aria-label={label} className="inline-flex">
			{options.map((o) => (
				<Button
					key={o.value}
					variant={o.value === value ? "soft" : "ghost"}
					color="secondary"
					size="xs"
					pill
					aria-pressed={o.value === value}
					onClick={() => onChange(o.value)}
					className="px-2 leading-[18px]"
				>
					{o.label}
				</Button>
			))}
		</div>
	);
}

/** A key hint inside a button or a row (Codex's): a 16px tag tinted from the text colour around it. */
export function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-current/10 px-1.5 font-ui text-xs leading-4">
			{children}
		</kbd>
	);
}
