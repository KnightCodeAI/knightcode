import { fauxProvider } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { accountHandlers } from "../../src/app-server/accounts.ts";
import { createAppServerContext } from "../../src/app-server/context.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { modelHandlers } from "../../src/app-server/models.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connect() {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-accounts-"));
	dirs.push(agentDir);
	const ctx = await createAppServerContext({ agentDir, credentials: new InMemoryCredentialStore(), modelsPath: null });
	const faux = fauxProvider({ provider: "faux-accounts" });
	ctx.models.registerNativeProvider(faux.provider);
	await ctx.models.refresh({ allowNetwork: false });
	const client = createInProcessClient({
		handlers: { ...accountHandlers(ctx), ...modelHandlers(ctx) },
		version: "0",
		onInitialized: (c) => ctx.connections.add(c),
		onClose: (c) => ctx.connections.delete(c),
	});
	await client.initialize();
	return { ctx, faux, client };
}

test("model/list includes the faux model and names no default when none is set", async () => {
	const { faux, client } = await connect();
	const { models, default: chosen } = await client.request("model/list", {});
	expect(models.some((m) => m.provider === "faux-accounts" && m.id === faux.getModel().id)).toBe(true);
	expect(chosen).toBeNull();
});

test("account/list carries metadata only, and an unknown provider cannot start a login", async () => {
	const { client } = await connect();
	const { accounts } = await client.request("account/list", {});
	expect(JSON.stringify(accounts)).not.toMatch(/key|token/i);
	await expect(client.request("account/login/start", { provider: "nope", type: "api_key" })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("account/logout broadcasts account/updated", async () => {
	const { client } = await connect();
	const seen: unknown[] = [];
	client.onNotification((method, params) => method === "account/updated" && seen.push(params));
	await client.request("account/logout", { provider: "faux-accounts" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(seen).toEqual([{ provider: "faux-accounts", authenticated: false }]);
});
