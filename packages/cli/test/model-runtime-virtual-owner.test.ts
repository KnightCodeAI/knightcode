import { fauxAssistantMessage, fauxProvider, InMemoryModelsStore } from "@knightcode/ai";
import { expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import type { VirtualModelDefinition } from "../src/core/virtual-models.ts";

/** The setup test/virtual-models.test.ts uses: an in-memory runtime with a faux provider, refreshed. */
async function runtimeWithTarget() {
	const models = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsStore: new InMemoryModelsStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const faux = fauxProvider({ provider: "faux-owner" });
	models.registerNativeProvider(faux.provider);
	await models.refresh({ allowNetwork: false });
	// The route must return a catalog model (ModelRoute.model is Model<Api>), as virtual-models.test.ts does.
	const target = models.getModel(faux.provider.id, faux.getModel().id)!;
	return { models, target, faux };
}

test("each owner resolves a shared virtual model through its own route", async () => {
	const { models, target } = await runtimeWithTarget();
	const seen: string[] = [];
	const ownerA = {};
	const ownerB = {};
	const definition = (label: string): VirtualModelDefinition => ({
		provider: "virt",
		id: "auto",
		name: "Auto",
		route: () => {
			seen.push(label);
			return { model: target, thinkingLevel: "off" };
		},
	});
	models.registerVirtualModel(definition("A"), ownerA);
	models.registerVirtualModel(definition("B"), ownerB);
	await models.refresh({ allowNetwork: false });
	const virtual = models.getModel("virt", "auto")!;
	const options = { reason: "direct" as const, thinkingLevel: "off" as const };
	await models.resolveModel(virtual, [], { ...options, owner: ownerA });
	await models.resolveModel(virtual, [], { ...options, owner: ownerB });
	expect(seen).toEqual(["A", "B"]);

	models.releaseVirtualModels(ownerB);
	expect(models.getModel("virt", "auto")).toBeDefined();
	await models.resolveModel(virtual, [], { ...options, owner: ownerA });
	expect(seen).toEqual(["A", "B", "A"]);
	await expect(models.resolveModel(virtual, [], { ...options, owner: ownerB })).rejects.toThrow(
		"not registered in this session",
	);

	models.releaseVirtualModels(ownerA);
	expect(models.getModel("virt", "auto")).toBeUndefined();
});

test("a registry bound to an owner streams a virtual model through that owner's route", async () => {
	const { models, target, faux } = await runtimeWithTarget();
	const seen: string[] = [];
	const ownerA = {};
	const ownerB = {};
	for (const [owner, label] of [
		[ownerA, "A"],
		[ownerB, "B"],
	] as const) {
		models.registerVirtualModel(
			{
				provider: "virt",
				id: "auto",
				name: "Auto",
				route: () => {
					seen.push(label);
					return { model: target, thinkingLevel: "off" };
				},
			},
			owner,
		);
	}
	await models.refresh({ allowNetwork: false });
	faux.setResponses([fauxAssistantMessage("direct")]);
	const registry = new ModelRegistry(models, ownerA);
	await registry.streamSimple(models.getModel("virt", "auto")!, { messages: [] }).result();
	expect(seen).toEqual(["A"]);
});

test("an unowned route serves every owner", async () => {
	const { models, target } = await runtimeWithTarget();
	models.registerVirtualModel({
		provider: "virt",
		id: "shared",
		name: "Shared",
		route: () => ({ model: target, thinkingLevel: "off" }),
	});
	await models.refresh({ allowNetwork: false });
	const virtual = models.getModel("virt", "shared")!;
	const route = await models.resolveModel(virtual, [], { reason: "direct", thinkingLevel: "off", owner: {} });
	expect(route.model.id).toBe(target.id);
});
