/**
 * Account routes.
 *
 * The IDE learns what it can sign in to, what is signed in, and how to sign
 * out, from here. Responses carry credential *metadata* only: no key, token, or
 * refresh token may appear in a body this module sends.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AuthEvent, AuthPrompt, AuthType } from "@knightcode/ai";
import type { EngineContext } from "./context.ts";
import { type EngineRoute, sendJson } from "./server.ts";

export interface AccountSummary {
	providerId: string;
	providerName: string;
	type: "api_key" | "oauth";
	isSubscription: boolean;
}

export interface LoginOption {
	providerId: string;
	providerName: string;
	type: "api_key" | "oauth";
	label: string;
	isSubscription: boolean;
}

function loginOptions(ctx: EngineContext): LoginOption[] {
	const options: LoginOption[] = [];
	for (const provider of ctx.models.getProviders()) {
		const oauth = provider.auth.oauth;
		if (oauth) {
			options.push({
				providerId: provider.id,
				providerName: provider.name,
				type: "oauth",
				label: oauth.loginLabel ?? oauth.name,
				isSubscription: oauth.isSubscription === true,
			});
		}
		// A provider without `login` is ambient-only: it resolves from an env
		// var or a credentials file and there is nothing for the IDE to prompt.
		const apiKey = provider.auth.apiKey;
		if (apiKey?.login) {
			options.push({
				providerId: provider.id,
				providerName: provider.name,
				type: "api_key",
				label: apiKey.name,
				isSubscription: false,
			});
		}
	}
	return options;
}

/**
 * The prompt as the IDE sees it: the question, never an answer. `AuthPrompt`
 * also carries an AbortSignal, which is meaningless over HTTP.
 */
export interface SerializablePrompt {
	type: AuthPrompt["type"];
	message: string;
	placeholder?: string;
	options?: readonly { id: string; label: string; description?: string }[];
}

export type LoginState =
	| {
			status: "pending";
			loginId: string;
			events: AuthEvent[];
			pendingPrompt?: { id: string; prompt: SerializablePrompt };
	  }
	| { status: "complete"; loginId: string; events: AuthEvent[] }
	| { status: "failed"; loginId: string; events: AuthEvent[]; error: string };

export interface LoginRegistry {
	start(providerId: string, type: AuthType): { loginId: string };
	get(loginId: string): LoginState | undefined;
	submit(loginId: string, value: string): boolean;
	cancel(loginId: string): boolean;
}

interface PendingPrompt {
	id: string;
	prompt: SerializablePrompt;
	resolve(value: string): void;
	reject(error: Error): void;
}

interface LoginRecord {
	loginId: string;
	providerId: string;
	status: "pending" | "complete" | "failed";
	events: AuthEvent[];
	error?: string;
	pending?: PendingPrompt;
	controller: AbortController;
}

function toSerializablePrompt(prompt: AuthPrompt): SerializablePrompt {
	return {
		type: prompt.type,
		message: prompt.message,
		placeholder: "placeholder" in prompt ? prompt.placeholder : undefined,
		options: "options" in prompt ? prompt.options : undefined,
	};
}

/**
 * Bridges `AuthInteraction` onto HTTP. `notify()` appends to a list the IDE
 * polls; `prompt()` parks and resolves when the IDE posts a value. This is why
 * the provider flows take an injected interaction rather than assuming a
 * terminal.
 */
export function createLoginRegistry(ctx: EngineContext): LoginRegistry {
	const logins = new Map<string, LoginRecord>();

	return {
		start(providerId, type) {
			const loginId = randomUUID();
			const record: LoginRecord = {
				loginId,
				providerId,
				status: "pending",
				events: [],
				controller: new AbortController(),
			};
			logins.set(loginId, record);

			const interaction = {
				signal: record.controller.signal,
				notify(event: AuthEvent) {
					record.events.push(event);
				},
				prompt(prompt: AuthPrompt) {
					return new Promise<string>((resolve, reject) => {
						record.pending = { id: randomUUID(), prompt: toSerializablePrompt(prompt), resolve, reject };
					});
				},
			};

			void ctx.models
				.login(providerId, type, interaction)
				.then(() => {
					record.status = "complete";
					record.pending = undefined;
					ctx.events.publish({ type: "account.changed", providerId, authenticated: true });
					ctx.events.publish({ type: "models.changed" });
				})
				.catch((error: unknown) => {
					record.status = "failed";
					record.pending = undefined;
					record.error = error instanceof Error ? error.message : String(error);
				});

			return { loginId };
		},

		get(loginId) {
			const record = logins.get(loginId);
			if (!record) return undefined;
			// `events` carries only auth_url, device_code, progress and info.
			// None hold an entered secret, and the prompt echoes the question only.
			if (record.status === "pending") {
				return {
					status: "pending",
					loginId,
					events: record.events,
					pendingPrompt: record.pending ? { id: record.pending.id, prompt: record.pending.prompt } : undefined,
				};
			}
			if (record.status === "complete") return { status: "complete", loginId, events: record.events };
			return { status: "failed", loginId, events: record.events, error: record.error ?? "login failed" };
		},

		submit(loginId, value) {
			const record = logins.get(loginId);
			if (!record?.pending) return false;
			const pending = record.pending;
			record.pending = undefined;
			pending.resolve(value);
			return true;
		},

		cancel(loginId) {
			const record = logins.get(loginId);
			if (!record) return false;
			record.pending?.reject(new Error("login cancelled"));
			record.pending = undefined;
			record.controller.abort();
			return true;
		},
	};
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > 64 * 1024) throw new Error("body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

export function accountsRoutes(ctx: EngineContext): readonly EngineRoute[] {
	const registry = createLoginRegistry(ctx);

	return [
		{
			method: "GET",
			path: "/v1/accounts",
			handle: async (_req, res) => {
				const stored = await ctx.credentials.list();
				const accounts: AccountSummary[] = stored.map((entry) => {
					const provider = ctx.models.getProvider(entry.providerId);
					return {
						providerId: entry.providerId,
						providerName: provider?.name ?? entry.providerId,
						type: entry.type,
						isSubscription: entry.type === "oauth" && provider?.auth.oauth?.isSubscription === true,
					};
				});
				sendJson(res, 200, { accounts, loginOptions: loginOptions(ctx) });
			},
		},
		{
			method: "POST",
			path: "/v1/accounts/login",
			handle: async (req, res) => {
				const body = await readJsonBody(req);
				const providerId = typeof body.providerId === "string" ? body.providerId : "";
				const provider = ctx.models.getProvider(providerId);
				if (!provider) {
					sendJson(res, 404, { error: "unknown_provider" });
					return;
				}
				const type: AuthType | undefined = body.type === "oauth" || body.type === "api_key" ? body.type : undefined;
				if (type === undefined) {
					sendJson(res, 400, { error: "unsupported_login_type" });
					return;
				}
				const supported =
					type === "oauth" ? provider.auth.oauth !== undefined : provider.auth.apiKey?.login !== undefined;
				if (!supported) {
					sendJson(res, 400, { error: "unsupported_login_type" });
					return;
				}
				sendJson(res, 200, registry.start(providerId, type));
			},
		},
		{
			method: "GET",
			path: "/v1/accounts/login",
			prefix: true,
			handle: (_req, res, url) => {
				const state = registry.get(url.pathname.slice("/v1/accounts/login/".length));
				if (!state) sendJson(res, 404, { error: "unknown_login" });
				else sendJson(res, 200, state);
			},
		},
		{
			// Registered before the account-delete route below, which would
			// otherwise match /v1/accounts/login/<id> and try to sign out of a
			// provider named "login/<id>".
			method: "DELETE",
			path: "/v1/accounts/login",
			prefix: true,
			handle: (_req, res, url) => {
				const found = registry.cancel(url.pathname.slice("/v1/accounts/login/".length));
				if (!found) {
					sendJson(res, 404, { error: "unknown_login" });
					return;
				}
				res.writeHead(204);
				res.end();
			},
		},
		{
			method: "POST",
			path: "/v1/accounts/login",
			prefix: true,
			handle: async (req, res, url) => {
				const rest = url.pathname.slice("/v1/accounts/login/".length);
				if (!rest.endsWith("/submit")) {
					sendJson(res, 404, { error: "not_found" });
					return;
				}
				const body = await readJsonBody(req);
				const value = typeof body.value === "string" ? body.value : "";
				if (!registry.submit(rest.slice(0, -"/submit".length), value)) {
					sendJson(res, 409, { error: "no_pending_prompt" });
					return;
				}
				sendJson(res, 200, { ok: true });
			},
		},
		{
			method: "DELETE",
			path: "/v1/accounts",
			prefix: true,
			handle: async (_req, res, url) => {
				const providerId = decodeURIComponent(url.pathname.slice("/v1/accounts/".length));
				if (!ctx.models.getProvider(providerId)) {
					sendJson(res, 404, { error: "unknown_provider" });
					return;
				}
				await ctx.models.logout(providerId);
				ctx.events.publish({ type: "account.changed", providerId, authenticated: false });
				res.writeHead(204);
				res.end();
			},
		},
	];
}
