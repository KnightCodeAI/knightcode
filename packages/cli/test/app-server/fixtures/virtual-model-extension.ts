import type { ExtensionAPI } from "../../../src/index.ts";

/** Session ids the router saw, in order. Module state on purpose: shared by every thread in the process. */
export const routedFrom: string[] = [];

/** A virtual model that routes to `target()` and records which session's context it ran with. */
export function virtualModelExtension(target: () => { provider: string; id: string }) {
	return (knightcode: ExtensionAPI): void => {
		knightcode.registerVirtualModel({
			provider: "virt",
			id: "auto",
			name: "Auto",
			route: (_request, ctx) => {
				routedFrom.push(ctx.sessionManager.getSessionId());
				const { provider, id } = target();
				return { model: ctx.modelRegistry.find(provider, id)!, thinkingLevel: "off" };
			},
		});
	};
}
