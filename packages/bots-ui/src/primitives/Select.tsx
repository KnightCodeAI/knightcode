// A compact select: a 24 px trigger showing the value, and a listbox on the menu surface.
import { ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cx } from "./cx.ts";

export interface SelectOption {
	value: string;
	label: string;
}

export interface SelectProps {
	value: string;
	onValueChange: (value: string) => void;
	options: SelectOption[];
	/** The accessible name. */
	label: string;
	className?: string;
	disabled?: boolean;
}

/** A select whose trigger is labelled `label` for assistive tech. */
export function Select({ value, onValueChange, options, label, className, disabled }: SelectProps) {
	return (
		<SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
			<SelectPrimitive.Trigger className={cx("kb-select__trigger", className)} aria-label={label}>
				<SelectPrimitive.Value />
				<SelectPrimitive.Icon className="kb-select__icon">
					<ChevronDown size={10} strokeWidth={2} />
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
			<SelectPrimitive.Portal>
				<SelectPrimitive.Content className="kb-floating" position="popper" sideOffset={6} collisionPadding={8}>
					<SelectPrimitive.Viewport className="kb-select__viewport">
						{options.map((option) => (
							<SelectPrimitive.Item key={option.value} value={option.value} className="kb-menu__item">
								<SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
							</SelectPrimitive.Item>
						))}
					</SelectPrimitive.Viewport>
				</SelectPrimitive.Content>
			</SelectPrimitive.Portal>
		</SelectPrimitive.Root>
	);
}
