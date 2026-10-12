import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { afterEach, expect, test, vi } from "vitest";
import { createLoginRegistry, type LoginRegistry } from "../../src/app-server/accounts.ts";
import { createAppServerContext } from "../../src/app-server/context.ts";

const dirs: string[] = [];
const registries: LoginRegistry[] = [];
afterEach(() => {
	for (const registry of registries.splice(0)) registry.dispose();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function setup(pendingTtlMs = 60_000, settledTtlMs = 60_000) {
	const agentDir = mkdtempSync(join(tmpdir(), "kc-login-"));
	dirs.push(agentDir);
	const ctx = await createAppServerContext({ agentDir, credentials: new InMemoryCredentialStore(), modelsPath: null });
	const seen: unknown[] = [];
	const registry = createLoginRegistry(ctx, { pendingTtlMs, settledTtlMs, onUpdate: (state) => seen.push(state) });
	registries.push(registry);
	return { ctx, registry, seen };
}

test("API key submission stores a secret but never echoes it in updates", async () => {
	const { ctx, registry, seen } = await setup();
	const { loginId } = registry.start("anthropic", "api_key");
	await vi.waitFor(() =>
		expect(registry.get(loginId)?.status === "pending" && registry.get(loginId)).toMatchObject({
			pendingPrompt: { prompt: { type: "secret" } },
		}),
	);
	expect(registry.submit(loginId, "sk-entered-secret")).toBe(true);
	expect(registry.submit(loginId, "second")).toBe(false);
	await vi.waitFor(() => expect(registry.get(loginId)?.status).toBe("complete"));
	expect(await ctx.credentials.read("anthropic")).toEqual({ type: "api_key", key: "sk-entered-secret" });
	expect(JSON.stringify(seen)).not.toContain("sk-entered-secret");
});

test("cancellation aborts a pending prompt, cannot be repeated and stores nothing", async () => {
	const { ctx, registry } = await setup();
	const { loginId } = registry.start("anthropic", "api_key");
	await vi.waitFor(() => expect(registry.get(loginId)).toMatchObject({ pendingPrompt: { id: expect.any(String) } }));
	expect(registry.cancel(loginId)).toBe(true);
	expect(registry.cancel(loginId)).toBe(false);
	expect(registry.submit(loginId, "late")).toBe(false);
	await Promise.resolve();
	expect(registry.get(loginId)).toMatchObject({ status: "failed", error: "login cancelled" });
	expect(await ctx.credentials.read("anthropic")).toBeUndefined();
});

test("abandoned flows time out and settled records are forgotten", async () => {
	const { registry } = await setup(30, 100);
	const { loginId } = registry.start("anthropic", "api_key");
	await vi.waitFor(() => expect(registry.get(loginId)).toMatchObject({ status: "failed", error: "login timed out" }), {
		interval: 5,
	});
	await vi.waitFor(() => expect(registry.size()).toBe(0));
	expect(registry.get(loginId)).toBeUndefined();
});

test("context shutdown disposes login registries and cannot leave pending prompts", async () => {
	const { ctx, registry } = await setup();
	const { loginId } = registry.start("anthropic", "api_key");
	await vi.waitFor(() => expect(registry.get(loginId)).toMatchObject({ pendingPrompt: { id: expect.any(String) } }));
	ctx.dispose();
	ctx.dispose();
	expect(registry.size()).toBe(0);
	expect(() => registry.start("anthropic", "api_key")).toThrow("closed");
	expect(await ctx.credentials.read("anthropic")).toBeUndefined();
});

test("disposing cancels pending flows and releases all timers", async () => {
	const { ctx, registry } = await setup();
	registry.start("anthropic", "api_key");
	registry.dispose();
	registry.dispose();
	expect(registry.size()).toBe(0);
	await Promise.resolve();
	expect(await ctx.credentials.read("anthropic")).toBeUndefined();
	expect(() => registry.start("anthropic", "api_key")).toThrow("closed");
});
