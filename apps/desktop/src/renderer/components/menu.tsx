/**
 * Menus, on Radix's dropdown menu as Codex builds its own (measured 2026-10-18). Radix renders a menu at the top of
 * the document, keeps it on screen, opens submenus on hover and gives every menu arrow keys, typeahead and Escape;
 * this module only draws them the way Codex does:
 *
 * - The surface (styles.css, .kc-menu): translucent and blurred, 20px superellipse corners, a half-pixel ring, a soft
 *   shadow. Every dropdown (menus, panels, hover cards, the composer's panel) draws on it, so they share one corner;
 *   `kc-menu-solid` is its opaque form. It sits 1px off its trigger with a 1px margin, starts at 220px and grows
 *   with its rows; nothing animates.
 * - A row (.kc-row): 13px, 28.5px tall, 15px superellipse corners, a 16px icon 6px before the label, a shortcut or
 *   chevron at the end in 12px half-strength text, a check at the end for the chosen item.
 * - A submenu opens 5px clear of the menu with its first row level with the row that opened it.
 *
 * Panels that are not lists of choices (a picker with a search field, a form) use Popover from popover.tsx; the
 * row pieces here are shared with it through RowContent.
 */

import { DropdownMenu } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button.tsx";
import { Check, ChevronDown, ChevronRight } from "./icons.tsx";

/** The inside of a row: its icon, label and description, then a hint and the end mark (a check or a chevron). */
export function RowContent({
	icon,
	description,
	hint,
	end,
	children,
}: {
	icon?: ReactNode;
	description?: ReactNode;
	hint?: ReactNode;
	end?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			{icon ? <span className={`flex shrink-0 ${description ? "self-start pt-[3px]" : ""}`}>{icon}</span> : null}
			<span className="min-w-0 flex-1">
				<span className="block truncate">{children}</span>
				{description ? <span className="kc-row-description">{description}</span> : null}
			</span>
			{hint ? <span className="kc-row-hint">{hint}</span> : null}
			{end}
		</>
	);
}

/**
 * Radix hands the focus back to a menu's or panel's trigger a tick after it closes. When the choice opened something
 * that took the focus (a dialog's field), that would take it back again; leave the focus where it went. Closing on
 * Escape leaves nothing focused (the panel is gone), so the trigger still gets it.
 */
export function keepMovedFocus(event: Event): void {
	const active = document.activeElement;
	if (active && active !== document.body) event.preventDefault();
}

export const Menu = DropdownMenu.Root;
export const MenuTrigger = (props: ComponentProps<typeof DropdownMenu.Trigger>) => (
	<DropdownMenu.Trigger asChild {...props} />
);
export const MenuRadioGroup = DropdownMenu.RadioGroup;

/**
 * The menu's surface. `variant="app"` is the title bar's File, Edit, View and Help menus, which Codex draws like
 * the system's (styles.css, .kc-app-menu).
 */
export function MenuContent({
	minWidth = 220,
	variant,
	className = "",
	style,
	onCloseAutoFocus,
	...props
}: ComponentProps<typeof DropdownMenu.Content> & { minWidth?: number; variant?: "app" }) {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				align="start"
				sideOffset={1}
				collisionPadding={8}
				style={{ minWidth, ...style }}
				className={`kc-menu ${variant === "app" ? "kc-app-menu" : ""} ${className}`}
				onCloseAutoFocus={(event) => {
					keepMovedFocus(event);
					onCloseAutoFocus?.(event);
				}}
				{...props}
			/>
		</DropdownMenu.Portal>
	);
}

type RowProps = {
	icon?: ReactNode;
	description?: ReactNode;
	hint?: ReactNode;
	/** Drawn in the caution colour, title and description both, as Codex draws Full access. */
	danger?: boolean;
	children: ReactNode;
};

/** A row's class and danger mark, shared by every kind of row. */
export const rowProps = (danger: boolean | undefined, className = "") => ({
	className: `kc-row ${danger ? "text-caution" : "text-ink"} ${className}`,
	"data-danger": danger || undefined,
});

/** An action. Choosing it closes the menu unless `onSelect` calls `event.preventDefault()`. */
export function MenuItem({
	icon,
	description,
	hint,
	danger,
	children,
	className,
	...props
}: RowProps & Omit<ComponentProps<typeof DropdownMenu.Item>, "children">) {
	return (
		<DropdownMenu.Item {...rowProps(danger, className)} {...props}>
			<RowContent icon={icon} description={description} hint={hint}>
				{children}
			</RowContent>
		</DropdownMenu.Item>
	);
}

const CHECK = (
	<DropdownMenu.ItemIndicator className="ms-2 flex shrink-0">
		<Check size={16} />
	</DropdownMenu.ItemIndicator>
);

/** A setting that is on or off; the menu stays open so several can be changed in one go. */
export function MenuCheckboxItem({
	icon,
	description,
	hint,
	danger,
	children,
	className,
	onSelect,
	...props
}: RowProps & Omit<ComponentProps<typeof DropdownMenu.CheckboxItem>, "children">) {
	return (
		<DropdownMenu.CheckboxItem
			{...rowProps(danger, className)}
			onSelect={(event) => {
				event.preventDefault();
				onSelect?.(event);
			}}
			{...props}
		>
			<RowContent icon={icon} description={description} hint={hint} end={CHECK}>
				{children}
			</RowContent>
		</DropdownMenu.CheckboxItem>
	);
}

/** One choice of several (inside a MenuRadioGroup); the chosen one carries the check. */
export function MenuRadioItem({
	icon,
	description,
	hint,
	danger,
	children,
	className,
	...props
}: RowProps & Omit<ComponentProps<typeof DropdownMenu.RadioItem>, "children">) {
	return (
		<DropdownMenu.RadioItem {...rowProps(danger, className)} {...props}>
			<RowContent icon={icon} description={description} hint={hint} end={CHECK}>
				{children}
			</RowContent>
		</DropdownMenu.RadioItem>
	);
}

/** A row that opens a submenu on hover, click or the right arrow, as Codex's "Copy ›" and "Committed ›" do. */
export function MenuSub({
	label,
	icon,
	minWidth = 0,
	className = "",
	onOpenChange,
	children,
}: {
	label: ReactNode;
	icon?: ReactNode;
	minWidth?: number;
	className?: string;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	return (
		<DropdownMenu.Sub onOpenChange={onOpenChange}>
			<DropdownMenu.SubTrigger {...rowProps(false)}>
				<RowContent icon={icon} hint={<ChevronRight size={16} />}>
					{label}
				</RowContent>
			</DropdownMenu.SubTrigger>
			<DropdownMenu.Portal>
				<DropdownMenu.SubContent
					sideOffset={8}
					alignOffset={-5}
					collisionPadding={8}
					style={{ minWidth }}
					className={`kc-menu ${className}`}
				>
					{children}
				</DropdownMenu.SubContent>
			</DropdownMenu.Portal>
		</DropdownMenu.Sub>
	);
}

/** The rule between groups of rows (styles.css, .kc-menu-separator). */
export const MenuSeparator = () => <DropdownMenu.Separator className="kc-menu-separator" />;

/** A menu's caption, as Codex heads its menus ("How should … act?"). */
export const MenuLabel = ({ children }: { children: ReactNode }) => (
	<DropdownMenu.Label className="kc-menu-label">{children}</DropdownMenu.Label>
);

/**
 * Codex's select (a setting's value): a field button with the current choice and a chevron, opening the choices as
 * a menu with a check on the current one.
 */
export function SelectMenu<T extends string>({
	value,
	options,
	onChange,
	label,
	icon,
}: {
	value: T | undefined;
	options: { value: T; label: string; description?: string }[];
	onChange: (value: T) => void;
	label: string;
	icon?: ReactNode;
}) {
	const current = options.find((o) => o.value === value);
	return (
		<Menu>
			<MenuTrigger>
				<Button variant="field" toolbar aria-label={label} className="max-w-64 px-3">
					{icon}
					<span className="truncate text-ink">{current?.label ?? "Choose…"}</span>
					<ChevronDown size={14} className="text-tertiary" />
				</Button>
			</MenuTrigger>
			<MenuContent align="end" className="max-h-80 overflow-y-auto">
				<MenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange(v as T)}>
					{options.map((o) => (
						<MenuRadioItem key={o.value} value={o.value} description={o.description}>
							{o.label}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuContent>
		</Menu>
	);
}
