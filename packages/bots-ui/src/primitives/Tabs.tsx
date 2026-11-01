// Pill tabs: a list of triggers and the panel of the selected one.
import { Tabs as TabsPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export interface TabItem {
	value: string;
	label: ReactNode;
	content?: ReactNode;
}

export interface TabsProps {
	items: TabItem[];
	value: string;
	onValueChange: (value: string) => void;
	/** Accessible name of the tab list. */
	label: string;
	/** `sm`: 26 px pills (detail panes); `md`: 28 px pills (settings). */
	size?: "sm" | "md";
	className?: string;
	listClassName?: string;
}

/** Tabs whose panels render only when selected. */
export function Tabs({ items, value, onValueChange, label, size = "sm", className, listClassName }: TabsProps) {
	return (
		<TabsPrimitive.Root className={className} value={value} onValueChange={onValueChange}>
			<TabsPrimitive.List className={cx("kb-tabs__list", listClassName)} aria-label={label}>
				{items.map((item) => (
					<TabsPrimitive.Trigger
						key={item.value}
						value={item.value}
						className={cx("kb-tabs__tab", size === "md" && "kb-tabs__tab--md")}
					>
						{item.label}
					</TabsPrimitive.Trigger>
				))}
			</TabsPrimitive.List>
			{items.map(
				(item) =>
					item.content !== undefined && (
						<TabsPrimitive.Content key={item.value} value={item.value}>
							{item.content}
						</TabsPrimitive.Content>
					),
			)}
		</TabsPrimitive.Root>
	);
}
