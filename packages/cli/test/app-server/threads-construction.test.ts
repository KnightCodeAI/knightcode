import { join } from "node:path";
import { clearExtensionCache, getExtensionCacheStats } from "../../src/core/extensions/loader.ts";
import { afterEach, expect, test, vi } from "vitest";
import type * as ServicesModule from "../../src/core/agent-session-services.ts";
import type { ExtensionAPI } from "../../src/index.ts";
import { cleanupServers, startServer } from "./harness.ts";

const failure = vi.hoisted(() => ({ on: false, gate: undefined as Promise<void> | undefined }));
vi.mock("../../src/core/agent-session-services.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof ServicesModule>();
	return {
		...actual,
		createAgentSessionFromServices: async (...args: Parameters<typeof actual.createAgentSessionFromServices>) => {
			await failure.gate;
			if (failure.on) throw new Error("session construction failed");
			return actual.createAgentSessionFromServices(...args);
		},
	};
});

afterEach(async () => {
	failure.on = false;
	failure.gate = undefined;
	vi.restoreAllMocks();
	await cleanupServers();
	clearExtensionCache();
});

test.each(["services", "session"])("a gated %s failure releases leased factories and owned routes", async (stage) => {
	clearExtensionCache();
	const { cwd, ctx, threads, connect } = await startServer({
		extensionPaths: [join(import.meta.dirname, "fixtures/cache-virtual-extension.ts")],
	});
	const a = await connect();
	let settle!: () => void;
	if (stage === "services") {
		const gate = new Promise<never>((_resolve, reject) => {
			settle = () => reject(new Error("services failed"));
		});
		// Registrations also trigger background refreshes; gate the awaited service pass too.
		void gate.catch(() => {});
		vi.spyOn(ctx.models, "refresh").mockImplementation(() => gate);
	} else {
		failure.on = true;
		failure.gate = new Promise<void>((resolve) => {
			settle = resolve;
		});
	}
	const starting = a.client.request("thread/start", { cwd });
	try {
		await vi.waitFor(() => expect(ctx.models.getModel("virt-cache", "auto")).toBeDefined(), { timeout: 20_000 });
		expect(getExtensionCacheStats()).toEqual({ active: 1, inactive: 0, importing: 0 });
	} finally {
		settle();
	}
	await expect(starting).rejects.toMatchObject({ code: "internal" });
	expect(getExtensionCacheStats()).toEqual({ active: 0, inactive: 1, importing: 0 });
	expect(ctx.models.getModel("virt-cache", "auto")).toBeUndefined();
	expect(threads.loadedCount()).toBe(0);
});

const virtual = (knightcode: ExtensionAPI) =>
	knightcode.registerVirtualModel({
		provider: "virt",
		id: "auto",
		name: "Auto",
		// Never called: the test only checks registration and release.
		route: (_request, ctx) => ({ model: ctx.modelRegistry.find("unused", "unused")!, thinkingLevel: "off" }),
	});

test("a load that fails after the services registered a virtual model leaves no route behind", async () => {
	const { cwd, ctx, threads, connect } = await startServer({ extraExtensions: [{ name: "virt", factory: virtual }] });
	const a = await connect();
	failure.on = true;
	await expect(a.client.request("thread/start", { cwd })).rejects.toMatchObject({ code: "internal" });
	expect(ctx.models.getModel("virt", "auto")).toBeUndefined();
	expect(threads.loadedCount()).toBe(0);
	failure.on = false;
	await a.client.request("thread/start", { cwd });
	expect(ctx.models.getModel("virt", "auto")).toBeDefined();
});
