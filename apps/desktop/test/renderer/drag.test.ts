/** An epoch may retire a resize handle before pointerup; its window listeners must retire with it. */
import { afterEach, expect, test, vi } from "vitest";
import { followDrag } from "../../src/renderer/drag.ts";
afterEach(() => vi.unstubAllGlobals());

test("an aborted owner ends its drag once and removes all later move/end effects", () => {
	const window = new EventTarget();
	vi.stubGlobal("window", window);
	const owner = new AbortController();
	let moves = 0;
	let ends = 0;
	followDrag(
		() => {
			moves++;
		},
		() => {
			ends++;
		},
		owner.signal,
	);
	window.dispatchEvent(Object.assign(new Event("pointermove"), { buttons: 1 }));
	expect(moves).toBe(1);
	owner.abort();
	window.dispatchEvent(Object.assign(new Event("pointermove"), { buttons: 1 }));
	window.dispatchEvent(new Event("pointerup"));
	expect(moves).toBe(1);
	expect(ends).toBe(1);
});
