// Modal surfaces live in the browser's top layer (a manual popover), above everything else on the page, as on the
// measured app. Menus, selects, popovers and tooltips opened inside one portal into that same layer, so they stay
// above it; elsewhere they portal to the body.
import { createContext, useContext, useLayoutEffect, useState } from "react";

const LayerContext = createContext<HTMLElement | undefined>(undefined);

/** Provides the layer floating content inside it should portal into. */
export const LayerProvider = LayerContext.Provider;

/** The current layer, or undefined for the body. */
export function useLayer(): HTMLElement | undefined {
	return useContext(LayerContext);
}

/** A top-layer host that is shown while `open`. Undefined until it exists, so content mounts once, inside it. */
export function useTopLayer(open: boolean): HTMLDivElement | undefined {
	const [host, setHost] = useState<HTMLDivElement>();
	useLayoutEffect(() => {
		const element = document.createElement("div");
		element.className = "kb-layer";
		element.setAttribute("popover", "manual");
		document.body.append(element);
		setHost(element);
		return () => element.remove();
	}, []);
	useLayoutEffect(() => {
		if (!host?.showPopover) return;
		const shown = host.matches(":popover-open");
		if (open && !shown) host.showPopover();
		if (!open && shown) host.hidePopover();
	}, [open, host]);
	return host;
}
