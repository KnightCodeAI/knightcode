// Solid mask boxes for pixel comparisons, painted the same way on the reference captures and on KnightCode's screens.
// Each matching element gets a box in its own layer: inside its open popover or modal dialog when it sits in the top
// layer, else on the body. Boxes are clipped to the element's scrolling ancestors, so scrolled-out content is not
// painted over what is visible.

export interface MaskTarget {
	selector: string;
	/** Only this match; every match when omitted. */
	nth?: number;
}

export interface MaskBox {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Painted inside the top layer (an open popover or modal dialog), above it, rather than on the body. */
	top?: boolean;
}

export const MASK_COLOR = "#FF00FF";

/**
 * Runs in the page (self-contained, passed to `page.evaluate`). Removes earlier masks, then paints `boxes` (a `top` box
 * goes into the most recently opened top-layer element) and a box over every element each target matches. Returns what
 * it painted. With `css: null` it only clears.
 */
export function paintMasksInPage(input: {
	targets: MaskTarget[];
	boxes: MaskBox[];
	color: string;
	css: string | null;
}): MaskBox[] {
	for (const old of document.querySelectorAll("[data-mask-overlay]")) old.remove();
	if (input.css === null) return [];
	const style = document.createElement("style");
	style.setAttribute("data-mask-overlay", "");
	style.textContent = input.css;
	document.head.append(style);
	const painted: MaskBox[] = [];
	const layers = document.querySelectorAll(":popover-open, dialog[open]");
	const topmost = layers[layers.length - 1] ?? document.body;
	const paint = (box: MaskBox, host: Element) => {
		const div = document.createElement("div");
		div.setAttribute("data-mask-overlay", "");
		div.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;background:${input.color};z-index:2147483647;pointer-events:none;margin:0;border:0;padding:0`;
		host.append(div);
		painted.push(host === document.body ? { ...box, top: undefined } : { ...box, top: true });
	};
	for (const box of input.boxes) paint(box, box.top ? topmost : document.body);
	for (const target of input.targets) {
		const all = [...document.querySelectorAll(target.selector)];
		for (const element of target.nth === undefined ? all : all.slice(target.nth, target.nth + 1)) {
			const rect = element.getBoundingClientRect();
			let left = rect.left;
			let top = rect.top;
			let right = rect.right;
			let bottom = rect.bottom;
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				const cs = getComputedStyle(parent);
				if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
				const clip = parent.getBoundingClientRect();
				left = Math.max(left, clip.left);
				top = Math.max(top, clip.top);
				right = Math.min(right, clip.right);
				bottom = Math.min(bottom, clip.bottom);
			}
			if (right - left <= 0 || bottom - top <= 0) continue;
			const host = element.closest(":popover-open, dialog[open]") ?? document.body;
			paint({ x: left, y: top, width: right - left, height: bottom - top }, host);
		}
	}
	return painted;
}
