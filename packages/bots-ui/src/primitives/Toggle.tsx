// An on/off switch.
import { Switch } from "radix-ui";

export interface ToggleProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	/** The accessible name. */
	label: string;
	disabled?: boolean;
}

/** A 32 x 20 switch whose thumb slides on the measured timing. */
export function Toggle({ checked, onCheckedChange, label, disabled }: ToggleProps) {
	return (
		<Switch.Root
			className="kb-switch"
			checked={checked}
			onCheckedChange={onCheckedChange}
			aria-label={label}
			disabled={disabled}
		>
			<Switch.Thumb className="kb-switch__thumb" />
		</Switch.Root>
	);
}
