import { useEffect, useRef } from "react";
import { type KeybindingId, matchesBinding } from "../shared/keybindings.ts";

export const isMac = () => window.knightcode.platform === "darwin";

export const matches = (event: KeyboardEvent | React.KeyboardEvent, id: KeybindingId) =>
	matchesBinding(event, id, isMac());

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
