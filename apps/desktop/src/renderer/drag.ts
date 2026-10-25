/**
 * Follow a resize drag from a handle's pointerdown until it ends. The listeners sit on the window, since a drag can
 * unmount its own handle (a pane dragged shut). It ends at pointerup, pointercancel, the window losing focus, or a
 * move with no button held (the button was released outside the window), so no listener outlives the drag.
 *
 * A move sets the pane's style itself and `onEnd` hands the final size to the store: a store update per move
 * re-rendered everything that reads the size (the side panel's whole diff), which made dragging lag.
 */
export function followDrag(onMove: (event: PointerEvent) => void, onEnd?: () => void): void {
	const move = (event: PointerEvent) => {
		if (event.buttons === 0) end();
		else onMove(event);
	};
	const end = () => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", end);
		window.removeEventListener("pointercancel", end);
		window.removeEventListener("blur", end);
		onEnd?.();
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", end);
	window.addEventListener("pointercancel", end);
	window.addEventListener("blur", end);
}
