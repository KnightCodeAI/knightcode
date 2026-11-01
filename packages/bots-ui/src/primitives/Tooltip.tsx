// A small label that appears on hover or focus.
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

export interface TooltipProps {
	content: ReactNode;
	children: ReactElement;
	side?: "top" | "right" | "bottom" | "left";
}

/** Wraps one focusable child. A provider higher up is optional; each tooltip carries its own. */
export function Tooltip({ content, children, side = "bottom" }: TooltipProps) {
	return (
		<TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={200}>
			<TooltipPrimitive.Root>
				<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
				<TooltipPrimitive.Portal>
					<TooltipPrimitive.Content className="kb-tooltip" side={side} sideOffset={8} collisionPadding={8}>
						{content}
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
		</TooltipPrimitive.Provider>
	);
}
