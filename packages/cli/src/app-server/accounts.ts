/** Account metadata and cancellable login flows. Answers and credentials never enter notifications. */
import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt, AuthType } from "@knightcode/ai";
import type { LoginState } from "@knightcode/app-server-protocol";
import type { AppServerContext } from "./context.ts";
import { AppServerError } from "./errors.ts";
import type { Handlers } from "./server.ts";

export type { LoginState };

interface LoginOption {
	provider: string;
	providerName: string;
	type: "api_key" | "oauth";
	label: string;
	isSubscription: boolean;
}

function loginOptions(ctx: AppServerContext): LoginOption[] {
	const options: LoginOption[] = [];
	for (const provider of ctx.models.getProviders()) {
		const oauth = provider.auth.oauth;
		if (oauth)
			options.push({
				provider: provider.id,
				providerName: provider.name,
				type: "oauth",
				label: oauth.loginLabel ?? oauth.name,
				isSubscription: oauth.isSubscription === true,
			});
		const apiKey = provider.auth.apiKey;
		if (apiKey?.login)
			options.push({
				provider: provider.id,
				providerName: provider.name,
				type: "api_key",
				label: apiKey.name,
				isSubscription: apiKey.isSubscription === true,
			});
	}
	return options;
}

export interface LoginRegistry {
	start(provider: string, type: AuthType): { loginId: string };
	get(loginId: string): LoginState | undefined;
	submit(loginId: string, value: string): boolean;
	cancel(loginId: string): boolean;
	size(): number;
	dispose(): void;
}

export interface LoginRegistryOptions {
	pendingTtlMs?: number;
	settledTtlMs?: number;
	onUpdate?: (state: LoginState) => void;
}

interface LoginRecord {
	loginId: string;
	status: "pending" | "complete" | "failed";
	events: AuthEvent[];
	error?: string;
	pending?: {
		id: string;
		prompt: NonNullable<Extract<LoginState, { status: "pending" }>["pendingPrompt"]>["prompt"];
		resolve(value: string): void;
		reject(error: Error): void;
	};
	controller: AbortController;
	timer?: ReturnType<typeof setTimeout>;
}

export function createLoginRegistry(ctx: AppServerContext, options: LoginRegistryOptions = {}): LoginRegistry {
	const logins = new Map<string, LoginRecord>();
	let disposed = false;
	function get(loginId: string): LoginState | undefined {
		const record = logins.get(loginId);
		if (!record) return undefined;
		const events = [...record.events];
		if (record.status === "pending")
			return {
				status: "pending",
				loginId,
				events,
				pendingPrompt: record.pending ? { id: record.pending.id, prompt: record.pending.prompt } : undefined,
			};
		if (record.status === "complete") return { status: "complete", loginId, events };
		return { status: "failed", loginId, events, error: record.error ?? "login failed" };
	}
	function report(record: LoginRecord): void {
		const state = get(record.loginId);
		if (state) options.onUpdate?.(state);
	}
	function settle(record: LoginRecord, status: "complete" | "failed", error?: string): boolean {
		if (record.status !== "pending") return false;
		record.status = status;
		record.pending = undefined;
		record.error = error;
		clearTimeout(record.timer);
		record.timer = setTimeout(() => logins.delete(record.loginId), options.settledTtlMs ?? 60_000);
		record.timer.unref();
		report(record);
		return true;
	}
	function abandon(record: LoginRecord, reason: string): void {
		const pending = record.pending;
		settle(record, "failed", reason);
		pending?.reject(new Error(reason));
		record.controller.abort();
	}
	const registry: LoginRegistry = {
		start(provider, type) {
			if (disposed) throw new AppServerError("internal", "login registry closed");
			const loginId = randomUUID();
			const record: LoginRecord = { loginId, status: "pending", events: [], controller: new AbortController() };
			logins.set(loginId, record);
			record.timer = setTimeout(() => abandon(record, "login timed out"), options.pendingTtlMs ?? 10 * 60_000);
			record.timer.unref();
			void ctx.models
				.login(
					provider,
					type,
					{
						signal: record.controller.signal,
						notify(event: AuthEvent) {
							if (record.status !== "pending") return;
							record.events.push(event);
							report(record);
						},
						prompt(prompt: AuthPrompt) {
							if (record.status !== "pending" || prompt.signal?.aborted)
								return Promise.reject(new Error("login cancelled"));
							return new Promise<string>((resolve, reject) => {
								const pending: NonNullable<LoginRecord["pending"]> = {
									id: randomUUID(),
									prompt: {
										type: prompt.type,
										message: prompt.message,
										placeholder: "placeholder" in prompt ? prompt.placeholder : undefined,
										options: "options" in prompt ? [...prompt.options] : undefined,
									},
									resolve,
									reject,
								};
								record.pending = pending;
								// The provider withdraws a prompt it no longer needs, e.g. the paste-the-redirect box once
								// the browser callback arrives; stop offering it to the client.
								prompt.signal?.addEventListener(
									"abort",
									() => {
										if (record.pending !== pending) return;
										record.pending = undefined;
										reject(new Error("login cancelled"));
										report(record);
									},
									{ once: true },
								);
								report(record);
							});
						},
					},
					// Sign in with ChatGPT registers this installation by its device ID, shared with the terminal UI.
					{ getDeviceId: () => ctx.settings.getOrCreateDeviceId() },
				)
				.then(() => {
					if (settle(record, "complete")) ctx.broadcast("account/updated", { provider, authenticated: true });
				})
				.catch((error: unknown) => settle(record, "failed", error instanceof Error ? error.message : String(error)));
			return { loginId };
		},
		get,
		submit(loginId, value) {
			const record = logins.get(loginId);
			if (!record?.pending || record.status !== "pending") return false;
			const pending = record.pending;
			record.pending = undefined;
			pending.resolve(value);
			report(record);
			return true;
		},
		cancel(loginId) {
			const record = logins.get(loginId);
			if (!record || record.status !== "pending") return false;
			abandon(record, "login cancelled");
			return true;
		},
		size: () => logins.size,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const record of logins.values()) {
				if (record.status === "pending") abandon(record, "app server shutdown");
				clearTimeout(record.timer);
			}
			logins.clear();
		},
	};
	ctx.onDispose(() => registry.dispose());
	return registry;
}

export function accountHandlers(ctx: AppServerContext): Handlers {
	const registry = createLoginRegistry(ctx, { onUpdate: (state) => ctx.broadcast("account/login/updated", state) });
	const known = (provider: string) => {
		if (!ctx.models.getProvider(provider)) throw new AppServerError("invalidParams", `unknown provider: ${provider}`);
	};
	return {
		"account/list": async () => {
			const stored = await ctx.credentials.list();
			return {
				accounts: stored.map((entry) => {
					const provider = ctx.models.getProvider(entry.providerId);
					return {
						provider: entry.providerId,
						providerName: provider?.name ?? entry.providerId,
						type: entry.type,
						isSubscription:
							(entry.type === "oauth" && provider?.auth.oauth?.isSubscription === true) ||
							provider?.auth.apiKey?.isSubscription === true,
					};
				}),
				loginOptions: loginOptions(ctx),
			};
		},
		"account/login/start": async ({ provider, type }) => {
			known(provider);
			const auth = ctx.models.getProvider(provider)!.auth;
			if (!(type === "oauth" ? auth.oauth !== undefined : auth.apiKey?.login !== undefined))
				throw new AppServerError("invalidParams", `${provider} has no ${type} login`);
			return registry.start(provider, type);
		},
		"account/login/answer": async ({ loginId, value }) => {
			if (!registry.submit(loginId, value)) throw new AppServerError("invalidParams", "no pending prompt");
			return {};
		},
		"account/login/cancel": async ({ loginId }) => {
			if (!registry.cancel(loginId)) throw new AppServerError("invalidParams", `unknown login: ${loginId}`);
			return {};
		},
		"account/logout": async ({ provider }) => {
			known(provider);
			await ctx.models.logout(provider);
			ctx.broadcast("account/updated", { provider, authenticated: false });
			return {};
		},
	};
}
