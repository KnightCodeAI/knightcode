import { useEffect, useRef } from "react";
import { DESKTOP_KEYBINDINGS, type KeybindingId, matchesBinding } from "../shared/keybindings.ts";

export const isMac = () => window.knightcode.platform === "darwin";

const KEY_NAMES: Record<string, string> = {
	arrowleft: "←",
	arrowright: "→",
	arrowup: "↑",
	arrowdown: "↓",
	bracketleft: "[",
	bracketright: "]",
	equal: "=",
	minus: "-",
	slash: "/",
	semicolon: ";",
	backquote: "`",
	numpadadd: "Num+",
	numpadsubtract: "Num-",
	f3: "F3",
	f11: "F11",
	...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`digit${i + 1}`, String(i + 1)])),
};

/** A key combination as people read it: `mod+shift+a` is "Ctrl+Shift+A" (⌘ on macOS). */
export const keyLabel = (keys: string) =>
	keys
		.split("+")
		.map((k) =>
			k === "mod"
				? isMac()
					? "⌘"
					: "Ctrl"
				: (KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1))),
		)
		.join("+");

type Overrides = Partial<Record<KeybindingId, string[]>>;
let overrides: Overrides = {};

/**
 * The user's rebindings (Settings › Keyboard shortcuts), which every match, label and menu hint below uses. The app
 * sets them from the preferences as it renders, before anything under it reads a binding.
 */
export function setBindingOverrides(next: Record<string, string[]> | undefined): void {
	overrides = (next ?? {}) as Overrides;
}

/** A binding's keys as the user has them: their rebinding, else the defaults; empty when unassigned. */
export const bindingKeys = (id: KeybindingId): readonly string[] =>
	overrides[id] ?? DESKTOP_KEYBINDINGS[id].defaultKeys;

/** A binding's first combination, for the hint beside a menu item; empty when unassigned. */
export const bindingLabel = (id: KeybindingId) => {
	const keys = bindingKeys(id)[0];
	return keys ? keyLabel(keys) : "";
};

const ACCELERATOR_NAMES: Record<string, string> = {
	mod: "CmdOrCtrl",
	ctrl: "Ctrl",
	alt: "Alt",
	shift: "Shift",
	meta: "Super",
	arrowleft: "Left",
	arrowright: "Right",
	arrowup: "Up",
	arrowdown: "Down",
	escape: "Esc",
	space: "Space",
	enter: "Enter",
	numpadadd: "numadd",
	numpadsubtract: "numsub",
};

/** A binding's first combination in Electron's accelerator syntax, for the hint in a native menu; none if unassigned. */
export const bindingAccelerator = (id: KeybindingId): string | undefined =>
	bindingKeys(id)[0]
		?.split("+")
		.map(
			(k) =>
				ACCELERATOR_NAMES[k] ?? KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1)),
		)
		.join("+");

export const matches = (event: KeyboardEvent | React.KeyboardEvent, id: KeybindingId) =>
	matchesBinding(event, id, isMac(), overrides);

export const isEditable = (target: EventTarget | null) =>
	target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));

/**
 * A window-level handler for one binding id; the latest handler always runs. Keys a field already
 * handled are skipped, and a handler returning `false` leaves the key to its default action.
 */
export function useBinding(id: KeybindingId, handler: (event: KeyboardEvent) => void | false, enabled = true): void {
	const ref = useRef(handler);
	ref.current = handler;
	useEffect(() => {
		if (!enabled) return;
		const listener = (event: KeyboardEvent) => {
			if (event.defaultPrevented || !matches(event, id)) return;
			if (ref.current(event) === false) return;
			event.preventDefault();
		};
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, [id, enabled]);
}

/**
 * Window-level handlers for a list of actions with bindings (a menu's actions, so a shortcut and its menu item run
 * the same code); the latest list always runs. As useBinding, keys a field already handled are skipped.
 */
export function useBindings(actions: readonly { binding?: KeybindingId; run: () => void }[], enabled = true): void {
	const ref = useRef(actions);
	ref.current = actions;
	useEffect(() => {
		if (!enabled) return;
		const listener = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const action = ref.current.find((a) => a.binding && matches(event, a.binding));
			if (!action) return;
			event.preventDefault();
			action.run();
		};
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, [enabled]);
}
