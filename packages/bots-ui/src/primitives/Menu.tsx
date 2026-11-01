// Dropdown menus: a trigger, then items, separators and groups on a floating surface.
import { DropdownMenu } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx.ts";
import { useLayer } from "./layer.tsx";

export interface MenuProps {
	trigger: ReactElement;
	children: ReactNode;
	align?: "start" | "center" | "end";
	side?: "top" | "right" | "bottom" | "left";
	/** Accessible name of the menu. */
	label?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	className?: string;
}

/** A menu opened by `trigger`. */
export function Menu({
	trigger,
	children,
	align = "start",
	side = "bottom",
	label,
	open,
	onOpenChange,
	className,
}: MenuProps) {
	const layer = useLayer();
	return (
		<DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
			<DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Portal container={layer}>
				<DropdownMenu.Content
					aria-label={label}
					className={cx("kb-floating", "kb-menu", className)}
					align={align}
					side={side}
					sideOffset={6}
					collisionPadding={8}
				>
					{children}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

export interface MenuItemProps {
	children: ReactNode;
	icon?: ReactNode;
	/** Trailing text or icon, such as a count or a chevron. */
	hint?: ReactNode;
	onSelect?: () => void;
	disabled?: boolean;
}

/** One action in a menu. */
export function MenuItem({ children, icon, hint, onSelect, disabled }: MenuItemProps) {
	return (
		<DropdownMenu.Item className="kb-menu__item" onSelect={onSelect} disabled={disabled}>
			{icon && <span className="kb-menu__item-icon">{icon}</span>}
			<span className="kb-menu__item-label">{children}</span>
			{hint && <span className="kb-menu__item-hint">{hint}</span>}
		</DropdownMenu.Item>
	);
}

/** A hairline between groups of items. */
export function MenuSeparator() {
	return <DropdownMenu.Separator className="kb-menu__separator" />;
}
