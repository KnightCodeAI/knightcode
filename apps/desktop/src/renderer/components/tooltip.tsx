import { Tooltip as TooltipPrimitive } from "radix-ui";
import { type ReactElement, type ReactNode, useRef, useState } from "react";

/**
 * A label shown while the pointer rests on `children` (one element that takes a ref and pointer handlers), as Codex's
 * Tooltip (measured 2026-10-19): after 150ms, 5px off its side (above unless it would leave the window), 15px clear
 * of the window's edges, at most 320px wide, gone on a press. Each has its own provider, so moving between triggers
 * waits the delay again, as Codex's do. With `overflow` it shows only while the trigger's text is cut off (a long
 * name's full text), so the trigger must be the truncating element. It replaces the native `title`, which Windows
 * draws as a boxed system tip.
 */
export function Tooltip({
	content,
	side,
	align,
	overflow,
	children,
}: {
	content: ReactNode;
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	overflow?: boolean;
	children: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	// Radix types the trigger as a button; with asChild it is whatever element `children` renders.
	const trigger = useRef<HTMLButtonElement>(null);
	if (content == null || content === "") return children;
	const cutOff = (el: HTMLElement | null) => el != null && el.scrollWidth > el.clientWidth;
	return (
		<TooltipPrimitive.Provider delayDuration={150}>
			<TooltipPrimitive.Root
				open={open}
				onOpenChange={(next) => setOpen(next && (!overflow || cutOff(trigger.current)))}
				disableHoverableContent
			>
				<TooltipPrimitive.Trigger asChild ref={trigger}>
					{children}
				</TooltipPrimitive.Trigger>
				<TooltipPrimitive.Portal>
					<TooltipPrimitive.Content
						side={side}
						align={align}
						sideOffset={5}
						collisionPadding={15}
						hideWhenDetached
						className="kc-tooltip"
					>
						{content}
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
		</TooltipPrimitive.Provider>
	);
}
