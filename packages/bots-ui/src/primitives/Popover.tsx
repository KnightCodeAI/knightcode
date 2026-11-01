// A floating panel anchored to a trigger, for pickers and inline forms.
import { Popover as PopoverPrimitive } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx.ts";

export interface PopoverProps {
	trigger: ReactElement;
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	align?: "start" | "center" | "end";
	side?: "top" | "right" | "bottom" | "left";
	label?: string;
	className?: string;
}

/** A popover on the menu surface. */
export function Popover({
	trigger,
	children,
	open,
	onOpenChange,
	align = "start",
	side = "bottom",
	label,
	className,
}: PopoverProps) {
	return (
		<PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					aria-label={label}
					className={cx("kb-floating", className)}
					align={align}
					side={side}
					sideOffset={6}
					collisionPadding={8}
				>
					{children}
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
