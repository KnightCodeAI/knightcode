/**
 * Panels that open from a button but are not a list of choices: a picker with its own search field, a small form,
 * the thread summary. They are Radix popovers drawn like Codex's menus (styles.css, .kc-menu), so they render at
 * the top of the document, stay on screen and close on Escape or a press outside. Lists of choices are menus
 * (menu.tsx); the rows below draw the same way for lists inside a panel or a sheet. HoverCard is the same surface
 * opened by resting the pointer on something (Codex's sidebar cards).
 */

import { HoverCard as HoverCardPrimitive, Popover as PopoverPrimitive } from "radix-ui";
import { type ReactElement, type ReactNode, type RefObject, useState } from "react";
import { Check } from "./icons.tsx";
import { keepMovedFocus, RowContent, rowProps } from "./menu.tsx";

export function Popover({
	trigger,
	children,
	side = "top",
	align = "start",
	anchor,
	sideOffset = 1,
	alignOffset = 0,
	className = "",
	open: shown,
	onOpenChange,
	takeFocus = true,
}: {
	/** One element, usually a button; Radix gives it the handlers that open the panel. */
	trigger: (open: boolean) => ReactNode;
	children: (close: () => void) => ReactNode;
	/** Whether the panel is open, for a caller that also opens it itself; it then keeps this in step from onOpenChange. */
	open?: boolean;
	/** Told of every open and close, including `close()` from inside. */
	onOpenChange?: (open: boolean) => void;
	/** False when the panel opened on its own, not from its trigger, and should leave the focus where it is. */
	takeFocus?: boolean;
	side?: "top" | "bottom";
	align?: "start" | "center" | "end";
	/** What the panel lines up with, when not the trigger (the thread summary lines up with the header). */
	anchor?: RefObject<HTMLElement | null>;
	sideOffset?: number;
	alignOffset?: number;
	className?: string;
}) {
	const [own, setOpen] = useState(false);
	const open = shown ?? own;
	const change = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
	};
	return (
		<PopoverPrimitive.Root open={open} onOpenChange={change}>
			<PopoverPrimitive.Trigger asChild>{trigger(open)}</PopoverPrimitive.Trigger>
			{/* After the trigger: on the first render the trigger anchors too, and the last anchor set wins. */}
			{anchor ? <PopoverPrimitive.Anchor virtualRef={anchor as RefObject<HTMLElement>} /> : null}
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					side={side}
					align={align}
					sideOffset={sideOffset}
					alignOffset={alignOffset}
					collisionPadding={8}
					// The panel takes the focus itself, not its first button (which would show a focus ring), unless
					// a field inside has already taken it (a search box with autoFocus).
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						if (!takeFocus) return;
						const panel = event.currentTarget as HTMLElement;
						if (!panel.contains(document.activeElement)) panel.focus();
					}}
					onCloseAutoFocus={keepMovedFocus}
					className={`kc-menu ${className}`}
				>
					{children(() => change(false))}
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}

/**
 * Details shown while the pointer rests on `children` (one element that takes a ref and pointer handlers), as Codex's
 * sidebar rows show a thread's or project's card: beside it, aligned with its top, 2px off. Radix's delays apply.
 */
export function HoverCard({ content, children }: { content: ReactNode; children: ReactElement }) {
	return (
		<HoverCardPrimitive.Root>
			<HoverCardPrimitive.Trigger asChild>{children}</HoverCardPrimitive.Trigger>
			<HoverCardPrimitive.Portal>
				<HoverCardPrimitive.Content
					side="right"
					align="start"
					sideOffset={2}
					collisionPadding={8}
					className="kc-menu flex w-72 flex-col gap-2 p-3 text-sm text-secondary"
				>
					{content}
				</HoverCardPrimitive.Content>
			</HoverCardPrimitive.Portal>
		</HoverCardPrimitive.Root>
	);
}

/** A row in a panel or a sheet: a plain button drawn as a menu row, with a check when it is the current choice. */
export function ListRow({
	icon,
	description,
	hint,
	checked,
	danger,
	onClick,
	children,
}: {
	icon?: ReactNode;
	description?: ReactNode;
	hint?: ReactNode;
	checked?: boolean;
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button type="button" onClick={onClick} data-checked={checked || undefined} {...rowProps(danger)}>
			<RowContent
				icon={icon}
				description={description}
				hint={hint}
				end={checked ? <Check size={16} className="ms-2 shrink-0" /> : null}
			>
				{children}
			</RowContent>
		</button>
	);
}

/** A caption over a list in a panel ("Local branches"). */
export const ListCaption = ({ children }: { children: ReactNode }) => <div className="kc-menu-label">{children}</div>;

/** The rule between groups of rows in a panel or a sheet. */
export const ListSeparator = () => <div role="separator" className="kc-menu-separator" />;
