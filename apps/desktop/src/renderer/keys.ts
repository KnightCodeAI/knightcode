import { useEffect, useRef } from "react";
import { type KeybindingId, matchesBinding } from "../shared/keybindings.ts";

export const isMac = () => window.knightcode.platform === "darwin";

export const matches = (event: KeyboardEvent | React.KeyboardEvent, id: KeybindingId) =>
	matchesBinding(event, id, isMac());

/** A window-level handler for one binding id; the latest handler always runs. */
export function useBinding(id: KeybindingId, handler: (event: KeyboardEvent) => void, enabled = true): void {
	const ref = useRef(handler);
	ref.current = handler;
	useEffect(() => {
		if (!enabled) return;
		const listener = (event: KeyboardEvent) => {
			if (!matches(event, id)) return;
			event.preventDefault();
			ref.current(event);
		};
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, [id, enabled]);
}
