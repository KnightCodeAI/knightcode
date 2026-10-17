import type { ExtensionAPI } from "../../../src/index.ts";

export default function cacheVirtual(knightcode: ExtensionAPI): void {
	knightcode.registerVirtualModel({
		provider: "virt-cache",
		id: "auto",
		name: "Cache cleanup probe",
		route: (_request, ctx) => ({ model: ctx.modelRegistry.find("unused", "unused")!, thinkingLevel: "off" }),
	});
}
