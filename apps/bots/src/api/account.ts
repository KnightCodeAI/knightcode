// The account: profile, handle, sign-in methods, onboarding, catch-up, search, model providers and models.
import type { RouteResponse } from "@knightcode/bots-protocol";
import { deleteAccount } from "../account/deletion.ts";
import { exportAccount } from "../account/export.ts";
import { handleOf } from "../auth/accounts.ts";
import { claimHandle } from "../auth/handle.ts";
import { beginPasskey, finishPasskey } from "../auth/passkeys.ts";
import { issueTicket } from "../auth/tickets.ts";
import { accountBotIds } from "./bots.ts";
import { botOf, defined, type Handlers, HttpError, userOf } from "./http.ts";

export const accountHandlers: Handlers = {
	getAccount: async (env, principal) => userOf(env, principal).account(),
	updateAccount: async (env, principal, patch) => userOf(env, principal).updateAccount(defined(patch)),
	claimHandle: async (env, principal, { handle }) => ({ result: await claimHandle(env.DB, principal.accountId, handle) }) as RouteResponse<"claimHandle">,
	listSignInMethods: async (env, principal) => {
		const identities = await env.DB.prepare("SELECT provider, email FROM identities WHERE account_id = ?").bind(principal.accountId).all<{ provider: string; email: string | null }>();
		const passkeys = await env.DB.prepare("SELECT id, name, created_at FROM passkeys WHERE account_id = ? ORDER BY created_at")
			.bind(principal.accountId)
			.all<{ id: string; name: string | null; created_at: number }>();
		const label = { github: "GitHub", google: "Google", email: "Email code" } as Record<string, string>;
		return {
			methods: identities.results
				.filter((row) => row.provider in label)
				.map((row) => ({ kind: row.provider as "github" | "google" | "email", label: row.email ? `${label[row.provider]} (${row.email})` : label[row.provider]! })),
			passkeys: passkeys.results.map((row) => ({ id: row.id, name: row.name ?? "Passkey", createdAt: row.created_at })),
		};
	},
	beginPasskey: async (env, principal) => ({ options: await beginPasskey(env, principal.accountId) }),
	addPasskey: async (env, principal, { name, response }) => {
		const id = await finishPasskey(env, response);
		if (!id) throw new HttpError(400, "passkey_refused", "the passkey could not be verified");
		const row = await env.DB.prepare("UPDATE passkeys SET name = ? WHERE id = ? AND account_id = ? RETURNING id, created_at")
			.bind(name, id, principal.accountId)
			.first<{ id: string; created_at: number }>();
		if (!row) throw new HttpError(400, "passkey_refused", "the passkey belongs to another account");
		return { id: row.id, name, createdAt: row.created_at };
	},
	deletePasskey: async (env, principal, { id }) => {
		await env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND account_id = ?").bind(id, principal.accountId).run();
		return { ok: true };
	},
	exportAccount: async (env, principal) => {
		const data = await exportAccount(env, principal);
		const file = await userOf(env, principal).putFile({ name: `knightcode-bots-export-${data.exportedAt.slice(0, 10)}.json`, kind: "bot-output", mime: "application/json" }, JSON.stringify(data));
		return { fileId: file.id };
	},
	deleteAccount: async (env, principal, { confirm }) => {
		const handle = await handleOf(env.DB, principal.accountId);
		if (!handle || confirm !== handle) throw new HttpError(400, "confirm_mismatch", "type your handle to confirm");
		await deleteAccount(env, principal);
		return { ok: true };
	},
	issueTicket: async (env, principal, { scope }) => {
		const ttlMs = 60_000;
		return { ticket: await issueTicket(env, principal, scope, ttlMs), expiresAt: Date.now() + ttlMs };
	},
	getOnboarding: async (env, principal) => userOf(env, principal).onboarding(),
	getCatchUp: async (env, principal) => ({ catchUp: await userOf(env, principal).catchUpNow() }),
	search: async (env, principal, { q }) => {
		const needle = q.toLowerCase();
		const hits: RouteResponse<"search">["hits"] = [];
		for (const id of await accountBotIds(env, principal)) {
			const found = await botOf(env, id).searchThread(principal, needle);
			hits.push(...found);
		}
		hits.push(...(await userOf(env, principal).searchAccount(needle)));
		return { hits };
	},

	listProviders: async (env, principal) => ({ providers: await userOf(env, principal).providers() }),
	connectProvider: async (env, principal, { provider, apiKey }) => {
		if (!apiKey) throw new HttpError(400, "sign_in_on_desktop", "connect this provider from the desktop app");
		return userOf(env, principal).connectApiKey(provider, apiKey);
	},
	beginEnrollment: async (env, principal, { provider }) => userOf(env, principal).beginEnrollment(provider),
	completeEnrollment: async (env, principal, { provider, token, credential }) => {
		const result = await userOf(env, principal).completeEnrollmentFor(provider, token, credential as never);
		if (!result) throw new HttpError(410, "enrollment_expired", "start connecting again");
		return result;
	},
	disconnectProvider: async (env, principal, { provider }) => {
		await userOf(env, principal).credentialDelete(provider);
		return { ok: true };
	},
	listModels: async (env, principal) => ({ models: await userOf(env, principal).models() }),
};
