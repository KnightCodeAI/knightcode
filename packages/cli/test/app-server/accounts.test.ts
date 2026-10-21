import { fauxProvider } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { accountHandlers, type LoginState } from "../../src/app-server/accounts.ts";
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

test("an OAuth login gets the installation's device ID and loses a prompt the provider withdraws", async () => {
	const { ctx, faux, client } = await connect();
	let deviceId: string | undefined;
	let finish!: () => void;
	ctx.models.registerNativeProvider({
		...faux.provider,
		auth: {
			...faux.provider.auth,
			oauth: {
				name: "Faux OAuth",
				async login(interaction, options) {
					deviceId = options?.getDeviceId?.();
					const withdraw = new AbortController();
					void interaction.prompt({ type: "manual_code", message: "paste", signal: withdraw.signal }).catch(() => {});
					await new Promise<void>((resolve) => {
						finish = () => {
							withdraw.abort();
							resolve();
						};
					});
					return { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 };
				},
				refresh: async (credential) => credential,
				toAuth: async (credential) => ({ apiKey: credential.access }),
			},
		},
	});
	const states: LoginState[] = [];
	client.onNotification((method, params) => method === "account/login/updated" && states.push(params as LoginState));
	await client.request("account/login/start", { provider: "faux-accounts", type: "oauth" });
	await vi.waitFor(() =>
		expect(states.at(-1)).toMatchObject({ status: "pending", pendingPrompt: { prompt: { message: "paste" } } }),
	);
	expect(deviceId).toBe(ctx.settings.getOrCreateDeviceId());

	finish();
	await vi.waitFor(() => expect(states.at(-1)?.status).toBe("complete"));
	expect(states.at(-2)).toMatchObject({ status: "pending", pendingPrompt: undefined });
});

test("account/logout broadcasts account/updated", async () => {
	const { client } = await connect();
	const seen: unknown[] = [];
	client.onNotification((method, params) => method === "account/updated" && seen.push(params));
	await client.request("account/logout", { provider: "faux-accounts" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(seen).toEqual([{ provider: "faux-accounts", authenticated: false }]);
});
