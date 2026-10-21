/**
 * A switch, on Radix Switch as Codex builds its own (measured 2026-10-19). "md" is the settings switch: 32 by 20,
 * a 10% track off and Codex's blue on, a 16px white knob that slides over 150ms. "sm" is the one in panels (New
 * worktree): 28 by 16 with a 12px knob, white when on.
 */

import { Switch as SwitchPrimitive } from "radix-ui";

export function Switch({
	checked,
	onChange,
	label,
	size = "md",
	disabled,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	size?: "sm" | "md";
	disabled?: boolean;
}) {
	return (
		<SwitchPrimitive.Root
			checked={checked}
			onCheckedChange={onChange}
			aria-label={label}
			disabled={disabled}
			data-size={size}
			className="kc-switch"
		>
			<SwitchPrimitive.Thumb className="kc-switch-thumb" />
		</SwitchPrimitive.Root>
	);
}
