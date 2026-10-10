import type { Credential, OAuthCredential } from "@knightcode/ai";
import { getKnightcodeUserAgent } from "@knightcode/ai/utils/user-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { fetchSubscriptionUsage, getUsageAccounts, UsageFetchError } from "../src/extensions/usage/providers.ts";

function oauth(access = "SECRET-TOKEN"): OAuthCredential {
	return { type: "oauth", access, refresh: "synthetic-refresh", expires: Date.now() + 3_600_000 };
}

async function registryWith(credentials: Record<string, Credential>) {
	const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(credentials), modelsPath: null });
	return { runtime, registry: new ModelRegistry(runtime) };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("usage account discovery", () => {
	it("discovers subscription sign-ins without a selected model", async () => {
		const { runtime, registry } = await registryWith({
			anthropic: oauth(),
			"openai-codex": oauth(),
			xai: oauth(jwt({ sub: "subject-id", marker: "SECRET-TOKEN" })),
			openai: oauth(),
			groq: { type: "api_key", key: "key" },
			ghost: oauth(),
			"ext-oauth": oauth(),
		});
		runtime.registerProvider("ext-oauth", {
			name: "Extension OAuth",
			baseUrl: "https://example.test/v1",
			api: "openai-completions",
			oauth: {
				name: "Generic OAuth",
				login: async () => oauth(),
				refreshToken: async (credential) => credential,
				getApiKey: (credential) => credential.access,
			},
			models: [],
		});
		const accounts = await getUsageAccounts(registry, {});
		expect(accounts.map(({ providerId, supported }) => ({ providerId, supported }))).toEqual([
			{ providerId: "anthropic", supported: true },
			{ providerId: "openai-codex", supported: true },
			{ providerId: "xai", supported: true },
			{ providerId: "openai", supported: false },
		]);
		expect(accounts[0].displayName).toBe("Anthropic");
		expect(accounts[2].displayName).toBe("xAI");
		expect(accounts[3].unsupportedReason).toContain("ChatGPT");
		const apiKeyRegistry = (await registryWith({ xai: { type: "api_key", key: "SECRET-TOKEN" } })).registry;
		expect(await getUsageAccounts(apiKeyRegistry, {})).toEqual([]);
	});

	it("orders the active provider first, even when unsupported", async () => {
		const { registry } = await registryWith({ anthropic: oauth(), "openai-codex": oauth(), openai: oauth() });
		expect((await getUsageAccounts(registry, { activeProviderId: "openai-codex" }))[0].providerId).toBe("openai-codex");
		expect((await getUsageAccounts(registry, { activeProviderId: "openai" }))[0].providerId).toBe("openai");
	});

	it("forwards cancellation to auth resolution and discovery", async () => {
		const { registry } = await registryWith({ anthropic: oauth() });
		const signal = AbortSignal.abort();
		await expect(registry.getProviderAuth("anthropic", { signal })).rejects.toThrow();
		await expect(getUsageAccounts(registry, { signal })).rejects.toThrow();
	});
});

function jwt(
	payload: unknown = { "https://api.openai.com/auth": { chatgpt_account_id: "account-id" }, marker: "SECRET-TOKEN-࿿" },
) {
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

const NOW = 1_000_000;
const XAI_TOKEN = jwt({ sub: "subject-id", marker: "SECRET-TOKEN" });
const XAI_END = "2026-10-13T10:55:15.438Z";
const xaiFixture = {
	config: {
		creditUsagePercent: 37.5,
		currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-10-06T10:55:15.438Z", end: XAI_END },
		isUnifiedBillingUser: true,
		productUsage: [],
	},
};
const codexFixture = {
	plan_type: "pro",
	rate_limit: {
		primary_window: { used_percent: 32, limit_window_seconds: 18000, reset_at: 1700000000, reset_after_seconds: 60 },
		secondary_window: {
			used_percent: 80,
			limit_window_seconds: 604800,
			reset_at: 1700001000,
			reset_after_seconds: 120,
		},
	},
};
const claudeFixture = {
	five_hour: { utilization: 32, resets_at: "2026-10-10T12:00:00Z" },
	seven_day: { utilization: 80, resets_at: null },
	seven_day_opus: { utilization: 40, resets_at: null },
	seven_day_sonnet: { utilization: 10, resets_at: null },
	seven_day_oauth_apps: { utilization: 5, resets_at: null },
	extra_usage: { is_enabled: true, monthly_limit: 10000, used_credits: 4000, utilization: 40 },
};

async function lookup(
	providerId: string,
	body: unknown,
	access = providerId === "openai-codex" ? jwt() : providerId === "xai" ? XAI_TOKEN : "SECRET-TOKEN",
) {
	const { registry } = await registryWith({ [providerId]: oauth(access) });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(body)),
	);
	return fetchSubscriptionUsage(registry, providerId, { signal: new AbortController().signal, now: () => NOW });
}

async function failureOf(operation: Promise<unknown>, kind: string, message?: string) {
	const error: unknown = await operation.catch((error: unknown) => error);
	expect(error).toBeInstanceOf(UsageFetchError);
	const failure = error as UsageFetchError;
	expect(failure.failure.kind).toBe(kind);
	if (message) expect(failure.message).toBe(message);
	for (const output of [failure.message, JSON.stringify(failure), failure.stack ?? ""]) {
		expect(output).not.toContain("SECRET-TOKEN");
		expect(output).not.toContain("RAW-RESPONSE");
	}
	expect(failure.cause).toBeUndefined();
	return failure.failure;
}

describe("usage provider adapters", () => {
	it.each([
		["anthropic", "https://api.anthropic.com/api/oauth/usage"],
		["openai-codex", "https://chatgpt.com/backend-api/wham/usage"],
		["xai", "https://cli-chat-proxy.grok.com/v1/billing?format=credits"],
	])("sends %s OAuth only to its fixed endpoint without redirects", async (id, url) => {
		const token = id === "openai-codex" ? jwt() : id === "xai" ? XAI_TOKEN : "SECRET-TOKEN";
		const { runtime, registry } = await registryWith({ [id]: oauth(token) });
		runtime.registerProvider(id, { baseUrl: "https://untrusted.test", headers: { "x-custom": "do-not-forward" } });
		const fetchMock = vi.fn(async () =>
			Response.json(id === "anthropic" ? claudeFixture : id === "xai" ? xaiFixture : codexFixture),
		);
		vi.stubGlobal("fetch", fetchMock);
		await fetchSubscriptionUsage(registry, id, { signal: new AbortController().signal });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [target, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(target).toBe(url);
		expect(init.method).toBe("GET");
		expect(init.redirect).toBe("error");
		const headers = new Headers(init.headers);
		expect(Object.fromEntries(headers)).toEqual(
			id === "anthropic"
				? {
						authorization: `Bearer ${token}`,
						accept: "application/json",
						"user-agent": getKnightcodeUserAgent(),
						"anthropic-beta": "oauth-2025-04-20",
					}
				: id === "xai"
					? {
							authorization: `Bearer ${token}`,
							accept: "application/json",
							"user-agent": getKnightcodeUserAgent(),
							"x-xai-token-auth": "xai-grok-cli",
						}
					: {
							authorization: `Bearer ${token}`,
							accept: "application/json",
							"user-agent": getKnightcodeUserAgent(),
							originator: "knightcode",
							"chatgpt-account-id": "account-id",
						},
		);
		if (id === "openai-codex") expect(token.split(".")[1]).toMatch(/[-_]/);
	});

	it.each([
		"malformed",
		"a.%%%.b",
		jwt({}),
		jwt({ "https://api.openai.com/auth": { chatgpt_account_id: 42 } }),
		jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "\nSECRET-TOKEN" } }),
	])("rejects a missing or malformed Codex claim before fetch: %s", async (token) => {
		const { registry } = await registryWith({ "openai-codex": oauth(token) });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await failureOf(
			fetchSubscriptionUsage(registry, "openai-codex", { signal: new AbortController().signal }),
			"auth",
			"Sign-in is missing account details. Run /login openai-codex.",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("never sends API-key sourced auth or unsupported ChatGPT auth", async () => {
		const { registry } = await registryWith({ anthropic: { type: "api_key", key: "SECRET-TOKEN" }, openai: oauth() });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await failureOf(
			fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal }),
			"auth",
			"Not signed in with a subscription. Run /login anthropic.",
		);
		await expect(
			fetchSubscriptionUsage(registry, "openai", { signal: new AbortController().signal }),
		).rejects.toBeInstanceOf(UsageFetchError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("maps missing auth and secret-bearing refresh errors safely", async () => {
		const { registry } = await registryWith({});
		vi.spyOn(registry, "getProviderAuth")
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("SECRET-TOKEN RAW-RESPONSE"));
		await failureOf(
			fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal }),
			"auth",
			"Not signed in with a subscription. Run /login anthropic.",
		);
		await failureOf(
			fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal }),
			"auth",
			"Sign-in could not be refreshed. Run /login anthropic.",
		);
	});

	it("reports remaining allowance, reset milliseconds, and sanitized plan name", async () => {
		expect(await lookup("openai-codex", codexFixture)).toEqual({
			providerId: "openai-codex",
			planName: "pro",
			checkedAt: NOW,
			windows: [
				{ label: "5-hour", windowSeconds: 18000, remainingPercent: 68, resetsAt: 1700000000000 },
				{ label: "Weekly", windowSeconds: 604800, remainingPercent: 20, resetsAt: 1700001000000 },
			],
		});
		expect((await lookup("openai-codex", { ...codexFixture, plan_type: "<script>" })).planName).toBeUndefined();
	});

	it.each([
		[100, 0],
		[125, 0],
		[0, 100],
		[null, null],
		[undefined, null],
		[-1, null],
		["32", null],
	])("normalizes used %s to remaining %s for both providers", async (used, remaining) => {
		const codex = await lookup("openai-codex", {
			...codexFixture,
			rate_limit: {
				primary_window: { ...codexFixture.rate_limit.primary_window, used_percent: used },
				secondary_window: null,
			},
		});
		const claude = await lookup("anthropic", { five_hour: { utilization: used, resets_at: null } });
		expect(codex.windows[0].remainingPercent).toBe(remaining);
		expect(claude.windows[0].remainingPercent).toBe(remaining);
	});

	it("sorts swapped Codex windows by duration, not primary/secondary names", async () => {
		const usage = await lookup("openai-codex", {
			...codexFixture,
			rate_limit: {
				primary_window: codexFixture.rate_limit.secondary_window,
				secondary_window: codexFixture.rate_limit.primary_window,
			},
		});
		expect(usage.windows.map((window) => window.label)).toEqual(["5-hour", "Weekly"]);
	});

	it.each([
		[86400, "1-day"],
		[2592000, "30-day"],
		[7200, "2-hour"],
		[123, "Usage window"],
		[-1, "Usage window"],
		["18000", "Usage window"],
	])("labels a single %s-second window as %s", async (seconds, label) => {
		const usage = await lookup("openai-codex", {
			rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: seconds }, secondary_window: null },
		});
		expect(usage.windows).toHaveLength(1);
		expect(usage.windows[0].label).toBe(label);
		expect(usage.windows[0].resetsAt).toBeNull();
	});

	it.each([
		[{ reset_at: "123", reset_after_seconds: 30 }, 1030000],
		[{ reset_at: -1, reset_after_seconds: 0 }, 1000000],
		[{ reset_after_seconds: "30" }, null],
		[{ reset_at: null, reset_after_seconds: -1 }, null],
		[{ reset_at: 1e300, reset_after_seconds: 30 }, 1030000],
	])("validates Codex resets and uses relative fallback", async (resets, expected) => {
		const usage = await lookup("openai-codex", { rate_limit: { primary_window: { used_percent: 10, ...resets } } });
		expect(usage.windows[0].resetsAt).toBe(expected);
	});

	it("parses Claude ISO resets and fixed scoped labels; ignores unknown and null buckets", async () => {
		const usage = await lookup("anthropic", {
			...claudeFixture,
			unknown_bucket: { utilization: 100 },
			seven_day: null,
		});
		expect(usage.windows.map((window) => window.label)).toEqual([
			"5-hour",
			"Weekly (Opus)",
			"Weekly (Sonnet)",
			"Weekly (OAuth apps)",
		]);
		expect(usage.windows[0].resetsAt).toBe(Date.parse("2026-10-10T12:00:00Z"));
		expect(
			(await lookup("anthropic", { five_hour: { utilization: 10, resets_at: "invalid" } })).windows[0].resetsAt,
		).toBeNull();
	});

	it.each([
		[undefined, undefined],
		[{ is_enabled: false }, { enabled: false }],
		[{ monthly_limit: null, utilization: 40 }, { enabled: false }],
		[{}, { enabled: false }],
		[{ is_enabled: "true", utilization: 40 }, { enabled: false }],
		[
			{ is_enabled: true, monthly_limit: null },
			{ enabled: true, unlimited: true },
		],
		[
			{ is_enabled: true, monthly_limit: 100, utilization: 40 },
			{ enabled: true, usedPercent: 40 },
		],
		[
			{ is_enabled: true, monthly_limit: 100, utilization: "40" },
			{ enabled: true, usedPercent: null },
		],
	])("normalizes Claude extra usage without currency amounts", async (extra, expected) => {
		expect((await lookup("anthropic", { ...claudeFixture, extra_usage: extra })).extraUsage).toEqual(expected);
	});

	it.each([
		[401, "auth", "Sign-in expired or was revoked. Run /login anthropic."],
		[403, "permission", "This sign-in cannot read usage."],
		[500, "network", "Usage service returned HTTP 500."],
	])("maps HTTP %s without retaining the response body", async (status, kind, message) => {
		const { registry } = await registryWith({ anthropic: oauth() });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("RAW-RESPONSE SECRET-TOKEN", { status })),
		);
		await failureOf(
			fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal }),
			kind,
			message,
		);
	});

	it.each([
		["30", 1030000],
		[new Date(NOW + 120000).toUTCString(), 1120000],
		[undefined, 1060000],
		["-1", 1060000],
		["garbage", 1060000],
		["999999", 4600000],
		["0", 1000000],
		[new Date(NOW - 120000).toUTCString(), 1060000],
	])("respects bounded Retry-After %s", async (retry, expected) => {
		const { registry } = await registryWith({ anthropic: oauth() });
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("RAW-RESPONSE SECRET-TOKEN", {
						status: 429,
						headers: retry === undefined ? {} : { "Retry-After": retry },
					}),
			),
		);
		const failure = await failureOf(
			fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal, now: () => NOW }),
			"rate_limit",
		);
		expect(failure.retryAt).toBe(expected);
	});

	it.each([
		"<html>RAW-RESPONSE SECRET-TOKEN</html>",
		"{RAW-RESPONSE SECRET-TOKEN",
		"null",
		"[]",
		"123",
		'"RAW-RESPONSE SECRET-TOKEN"',
	])("rejects non-object or malformed JSON safely", async (body) => {
		const { registry } = await registryWith({ anthropic: oauth() });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body)),
		);
		await failureOf(
			fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal }),
			"invalid_response",
			"Usage service returned an unexpected response.",
		);
	});

	it("releases an unused HTTP error response body without waiting for it to finish", async () => {
		const { registry } = await registryWith({ anthropic: oauth() });
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 500 })),
		);
		await failureOf(
			fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal }),
			"network",
			"Usage service returned HTTP 500.",
		);
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("maps secret-bearing fetch and body-read exceptions to fixed network failures", async () => {
		const { registry } = await registryWith({ anthropic: oauth() });
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("SECRET-TOKEN RAW-RESPONSE"))
			.mockResolvedValueOnce({
				ok: true,
				text: async () => {
					throw new Error("RAW-RESPONSE SECRET-TOKEN");
				},
			});
		vi.stubGlobal("fetch", fetchMock);
		for (let i = 0; i < 2; i++)
			await failureOf(
				fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal }),
				"network",
				"Could not reach the usage service.",
			);
	});

	it.each(["auth", "fetch", "body"])(
		"enforces the deadline during %s even when the operation ignores its signal",
		async (stage) => {
			const { registry } = await registryWith({ anthropic: oauth() });
			const never = () => new Promise<never>(() => {});
			if (stage === "auth") vi.spyOn(registry, "getProviderAuth").mockImplementation(never);
			vi.stubGlobal("fetch", stage === "body" ? vi.fn(async () => ({ ok: true, text: never })) : vi.fn(never));
			await failureOf(
				fetchSubscriptionUsage(registry, "anthropic", { signal: new AbortController().signal, timeoutMs: 10 }),
				"timeout",
				"Usage lookup timed out.",
			);
		},
	);

	it("rethrows caller cancellation rather than reporting a timeout or rendering secrets", async () => {
		const { registry } = await registryWith({ anthropic: oauth() });
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<never>(() => {})),
		);
		const controller = new AbortController();
		const operation = fetchSubscriptionUsage(registry, "anthropic", { signal: controller.signal });
		controller.abort();
		const error = await operation.catch((error: unknown) => error);
		expect(error).toBe(controller.signal.reason);
		expect(error).not.toBeInstanceOf(UsageFetchError);
	});
});

describe("Grok usage normalization", () => {
	it("reports the weekly unified pool using the explicit fractional percentage", async () => {
		expect(await lookup("xai", xaiFixture)).toEqual({
			providerId: "xai",
			checkedAt: NOW,
			windows: [{ label: "Weekly", remainingPercent: 62.5, resetsAt: Date.parse(XAI_END) }],
		});
	});

	it.each([
		{ name: "monthly", period: { type: "USAGE_PERIOD_TYPE_MONTHLY", end: XAI_END }, label: "Monthly" },
		{ name: "missing type", period: { end: XAI_END }, label: "Usage" },
		{ name: "unknown type", period: { type: "SECRET-TOKEN RAW-RESPONSE", end: XAI_END }, label: "Usage" },
	])("uses a fixed label for $name periods", async ({ period, label }) => {
		const usage = await lookup("xai", { config: { ...xaiFixture.config, currentPeriod: period } });
		expect(usage.windows[0].label).toBe(label);
		expect(usage.planName).toBeUndefined();
	});

	it.each([
		{ name: "exhausted", fields: { creditUsagePercent: 100 }, remaining: 0 },
		{ name: "over limit", fields: { creditUsagePercent: 130 }, remaining: 0 },
		{
			name: "reported zero on unified account",
			fields: { creditUsagePercent: 0, isUnifiedBillingUser: true },
			remaining: 100,
		},
		{
			name: "negative percent falls back",
			fields: { creditUsagePercent: -1, monthlyLimit: { val: 1000 }, used: { val: 250 } },
			remaining: 75,
		},
		{
			name: "numeric string falls back",
			fields: { creditUsagePercent: "40", monthlyLimit: { val: 1000 }, used: { val: 250 } },
			remaining: 75,
		},
		{
			name: "null percent falls back",
			fields: { creditUsagePercent: null, monthlyLimit: { val: 1000 }, used: { val: 250 } },
			remaining: 75,
		},
		{ name: "deprecated amounts", fields: { monthlyLimit: { val: 1000 }, used: { val: 250 } }, remaining: 75 },
		{ name: "proto3 zero amount", fields: { monthlyLimit: { val: 1000 }, used: {} }, remaining: 100 },
		{ name: "omitted zero amount", fields: { monthlyLimit: { val: 1000 } }, remaining: 100 },
		{ name: "amount over limit", fields: { monthlyLimit: { val: 1000 }, used: { val: 1250 } }, remaining: 0 },
		{ name: "missing percent in active non-unified period", fields: {}, remaining: 100 },
		{ name: "zero proto3 limit in active non-unified period", fields: { monthlyLimit: {}, used: {} }, remaining: 100 },
		{ name: "missing percent on unified account", fields: { isUnifiedBillingUser: true }, remaining: null },
		{
			name: "unified account with zero limit",
			fields: { isUnifiedBillingUser: true, monthlyLimit: {} },
			remaining: null,
		},
		{ name: "ended period", fields: { currentPeriod: { end: "1970-01-01T00:00:00Z" } }, remaining: null },
		{ name: "reset at checked time", fields: { currentPeriod: { end: "1970-01-01T00:16:40Z" } }, remaining: null },
		{ name: "invalid period end", fields: { currentPeriod: { end: "RAW-RESPONSE" } }, remaining: null },
		{ name: "missing period end", fields: { currentPeriod: {} }, remaining: null },
		{ name: "invalid used amount", fields: { monthlyLimit: { val: 1000 }, used: { val: "250" } }, remaining: null },
		{ name: "negative used amount", fields: { monthlyLimit: { val: 1000 }, used: { val: -1 } }, remaining: null },
		{ name: "overflowed ratio", fields: { monthlyLimit: { val: 1e-300 }, used: { val: 1e300 } }, remaining: null },
	])("normalizes $name without inventing unified-account quota", async ({ fields, remaining }) => {
		const config = { currentPeriod: xaiFixture.config.currentPeriod, ...fields };
		const usage = await lookup("xai", { config });
		expect(usage.windows[0].remainingPercent).toBe(remaining);
	});

	it.each([-1, "40", null, true])(
		"does not mistake an explicitly invalid percentage %s for an omitted proto3 zero",
		async (creditUsagePercent) => {
			const usage = await lookup("xai", {
				config: { creditUsagePercent, currentPeriod: xaiFixture.config.currentPeriod },
			});
			expect(usage.windows[0].remainingPercent).toBeNull();
		},
	);

	it("uses deprecated period end only when the current end is absent", async () => {
		const usage = await lookup("xai", { config: { creditUsagePercent: 40, billingPeriodEnd: XAI_END } });
		expect(usage.windows[0]).toEqual({ label: "Usage", remainingPercent: 60, resetsAt: Date.parse(XAI_END) });
		const malformed = await lookup("xai", {
			config: { creditUsagePercent: 40, currentPeriod: { end: "invalid" }, billingPeriodEnd: XAI_END },
		});
		expect(malformed.windows[0].resetsAt).toBeNull();
	});

	it("reports only known product shares, with the same reset as the pool", async () => {
		const usage = await lookup("xai", {
			config: {
				...xaiFixture.config,
				productUsage: [
					{ product: "GrokBuild", usagePercent: 20 },
					{ product: "Api", usagePercent: 5 },
					{ product: "unknown", usagePercent: 10 },
					{ product: "toString", usagePercent: 10 },
					null,
				],
			},
		});
		expect(usage.windows).toEqual([
			{ label: "Weekly", remainingPercent: 62.5, resetsAt: Date.parse(XAI_END) },
			{ label: "Weekly (Grok Build)", remainingPercent: 80, resetsAt: Date.parse(XAI_END) },
			{ label: "Weekly (API)", remainingPercent: 95, resetsAt: Date.parse(XAI_END) },
		]);
	});

	it.each([null, {}, "RAW-RESPONSE"])("ignores non-array productUsage: %s", async (productUsage) => {
		expect((await lookup("xai", { config: { ...xaiFixture.config, productUsage } })).windows).toHaveLength(1);
	});

	it("keeps missing or invalid product shares unavailable", async () => {
		const usage = await lookup("xai", {
			config: {
				...xaiFixture.config,
				productUsage: [{ product: "GrokBuild" }, { product: "Api", usagePercent: "20" }],
			},
		});
		expect(usage.windows.slice(1).map((window) => window.remainingPercent)).toEqual([null, null]);
	});

	it.each([{}, { config: null }, { config: [] }, { config: "RAW-RESPONSE SECRET-TOKEN" }, null, []])(
		"requires an object config",
		async (body) => {
			await failureOf(lookup("xai", body), "invalid_response", "Usage service returned an unexpected response.");
		},
	);

	it("rejects xAI API keys before calling the billing endpoint", async () => {
		const { registry } = await registryWith({ xai: { type: "api_key", key: "SECRET-TOKEN" } });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await failureOf(
			fetchSubscriptionUsage(registry, "xai", { signal: new AbortController().signal }),
			"auth",
			"Not signed in with a subscription. Run /login xai.",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		{ status: 401, kind: "auth", message: "Sign-in expired or was revoked. Run /login xai." },
		{ status: 403, kind: "permission", message: "This sign-in cannot read usage." },
		{ status: 429, kind: "rate_limit", message: "Rate limited. Try again in under 1m." },
		{ status: 500, kind: "network", message: "Usage service returned HTTP 500." },
		{ status: 200, kind: "invalid_response", message: "Usage service returned an unexpected response." },
	])("maps Grok HTTP $status without exposing tokens or error bodies", async ({ status, kind, message }) => {
		const { registry } = await registryWith({ xai: oauth(XAI_TOKEN) });
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<html>RAW-RESPONSE SECRET-TOKEN</html>", { status, headers: { "Retry-After": "30" } }),
			),
		);
		const failure = await failureOf(
			fetchSubscriptionUsage(registry, "xai", { signal: new AbortController().signal, now: () => NOW }),
			kind,
			message,
		);
		if (status === 429) expect(failure.retryAt).toBe(1030000);
	});

	it("sanitizes Grok network and refresh errors", async () => {
		const { registry } = await registryWith({ xai: oauth(XAI_TOKEN) });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("SECRET-TOKEN RAW-RESPONSE");
			}),
		);
		await failureOf(
			fetchSubscriptionUsage(registry, "xai", { signal: new AbortController().signal }),
			"network",
			"Could not reach the usage service.",
		);
		vi.spyOn(registry, "getProviderAuth").mockRejectedValue(new Error("SECRET-TOKEN RAW-RESPONSE"));
		await failureOf(
			fetchSubscriptionUsage(registry, "xai", { signal: new AbortController().signal }),
			"auth",
			"Sign-in could not be refreshed. Run /login xai.",
		);
	});
});
