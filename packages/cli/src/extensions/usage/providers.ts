import { getKnightcodeUserAgent } from "@knightcode/ai/utils/user-agent";
import type { ModelRegistry } from "../../core/model-registry.ts";
import { raceWithAbortSignal } from "../../utils/abort.ts";

export interface UsageAccount {
	providerId: string;
	displayName: string;
	supported: boolean;
	unsupportedReason?: string;
}

export interface UsageWindow {
	label: string;
	windowSeconds?: number;
	remainingPercent: number | null;
	resetsAt: number | null;
}

export type ExtraUsage =
	{ enabled: false } | { enabled: true; unlimited: true } | { enabled: true; usedPercent: number | null };

export interface SubscriptionUsage {
	providerId: string;
	planName?: string;
	windows: UsageWindow[];
	extraUsage?: ExtraUsage;
	checkedAt: number;
}

export interface UsageFailure {
	kind: "auth" | "permission" | "rate_limit" | "timeout" | "network" | "invalid_response";
	message: string;
	retryAt?: number;
}

export type UsageRow = { account: UsageAccount } & (
	| { state: "loading" }
	| { state: "ok"; usage: SubscriptionUsage }
	| { state: "error"; failure: UsageFailure }
	| { state: "unsupported" }
);

const SUPPORTED = new Set(["anthropic", "openai-codex", "xai"]);
const XAI_PRODUCT_LABELS = new Map([
	["GrokBuild", "Grok Build"],
	["Api", "API"],
]);

export async function getUsageAccounts(
	registry: ModelRegistry,
	options: { activeProviderId?: string; signal?: AbortSignal },
): Promise<UsageAccount[]> {
	const credentials = await registry.listCredentials({ signal: options.signal });
	const accounts: UsageAccount[] = [];
	for (const info of credentials) {
		if (info.type !== "oauth" || registry.getProvider(info.providerId)?.auth.oauth?.isSubscription !== true) continue;
		const supported = SUPPORTED.has(info.providerId);
		accounts.push({
			providerId: info.providerId,
			displayName: registry.getProviderDisplayName(info.providerId),
			supported,
			...(!supported
				? {
						unsupportedReason:
							info.providerId === "openai"
								? "Usage lookup is not available for this ChatGPT sign-in yet."
								: "Usage lookup is not available for this provider.",
					}
				: {}),
		});
	}
	const rank = (account: UsageAccount) =>
		account.providerId === options.activeProviderId ? 0 : account.supported ? 1 : 2;
	return accounts.sort((a, b) => rank(a) - rank(b));
}

export class UsageFetchError extends Error {
	readonly failure: UsageFailure;

	constructor(failure: UsageFailure) {
		super(failure.message);
		this.name = "UsageFetchError";
		this.failure = failure;
	}
}

export function formatUsageDuration(milliseconds: number): string {
	const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
	if (minutes < 1) return "under 1m";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function nonnegative(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function remaining(value: unknown): number | null {
	const used = nonnegative(value);
	return used === null ? null : Math.max(0, 100 - used);
}

function validTime(value: number): number | null {
	return Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : null;
}

function parseClaude(body: Record<string, unknown>, checkedAt: number): SubscriptionUsage {
	const labels = {
		five_hour: "5-hour",
		seven_day: "Weekly",
		seven_day_opus: "Weekly (Opus)",
		seven_day_sonnet: "Weekly (Sonnet)",
		seven_day_oauth_apps: "Weekly (OAuth apps)",
	};
	const windows: UsageWindow[] = [];
	for (const [key, label] of Object.entries(labels)) {
		const bucket = object(body[key]);
		if (!bucket) continue;
		windows.push({
			label,
			remainingPercent: remaining(bucket.utilization),
			resetsAt: typeof bucket.resets_at === "string" ? validTime(Date.parse(bucket.resets_at)) : null,
		});
	}
	const extra = object(body.extra_usage);
	const extraUsage: ExtraUsage | undefined = !extra
		? undefined
		: extra.is_enabled !== true
			? { enabled: false }
			: extra.monthly_limit === null
				? { enabled: true, unlimited: true }
				: { enabled: true, usedPercent: nonnegative(extra.utilization) };
	return { providerId: "anthropic", windows, checkedAt, ...(extraUsage ? { extraUsage } : {}) };
}

function parseCodex(body: Record<string, unknown>, checkedAt: number): SubscriptionUsage {
	const limits = object(body.rate_limit);
	const windows: UsageWindow[] = [];
	for (const key of ["primary_window", "secondary_window"]) {
		const bucket = object(limits?.[key]);
		if (!bucket) continue;
		const duration = nonnegative(bucket.limit_window_seconds);
		const seconds = duration !== null && duration > 0 ? duration : undefined;
		const label =
			seconds === 18000
				? "5-hour"
				: seconds === 604800
					? "Weekly"
					: seconds !== undefined && seconds % 86400 === 0
						? `${seconds / 86400}-day`
						: seconds !== undefined && seconds % 3600 === 0
							? `${seconds / 3600}-hour`
							: "Usage window";
		const absolute = nonnegative(bucket.reset_at);
		const relative = nonnegative(bucket.reset_after_seconds);
		const resetsAt =
			(absolute === null ? null : validTime(absolute * 1000)) ??
			(relative === null ? null : validTime(checkedAt + relative * 1000));
		windows.push({
			label,
			...(seconds !== undefined ? { windowSeconds: seconds } : {}),
			remainingPercent: remaining(bucket.used_percent),
			resetsAt,
		});
	}
	windows.sort((a, b) => (a.windowSeconds ?? Infinity) - (b.windowSeconds ?? Infinity));
	const planName =
		typeof body.plan_type === "string" && /^[\w .-]{1,32}$/.test(body.plan_type) ? body.plan_type : undefined;
	return { providerId: "openai-codex", windows, checkedAt, ...(planName ? { planName } : {}) };
}

function parseXai(body: Record<string, unknown>, checkedAt: number): SubscriptionUsage {
	const config = object(body.config);
	if (!config) {
		throw new UsageFetchError({ kind: "invalid_response", message: "Usage service returned an unexpected response." });
	}
	const period = object(config.currentPeriod);
	const type = typeof period?.type === "string" ? period.type : "";
	const label = type.includes("WEEKLY") ? "Weekly" : type.includes("MONTHLY") ? "Monthly" : "Usage";
	const end = period?.end ?? config.billingPeriodEnd;
	const resetsAt = typeof end === "string" ? validTime(Date.parse(end)) : null;
	let usedPercent = nonnegative(config.creditUsagePercent);
	if (usedPercent === null) {
		const limit = nonnegative(object(config.monthlyLimit)?.val);
		if (limit !== null && limit > 0) {
			const amount = object(config.used);
			// Proto3 omits zero fields, including val in a zero amount object.
			const used = config.used === undefined || (amount && amount.val === undefined) ? 0 : nonnegative(amount?.val);
			usedPercent = used === null ? null : nonnegative((used / limit) * 100);
		} else if (
			config.creditUsagePercent === undefined &&
			resetsAt !== null &&
			resetsAt > checkedAt &&
			config.isUnifiedBillingUser !== true
		) {
			// Only an omission represents proto3 zero; explicitly invalid values stay unavailable.
			usedPercent = 0;
		}
	}
	const windows: UsageWindow[] = [{ label, remainingPercent: remaining(usedPercent), resetsAt }];
	if (Array.isArray(config.productUsage)) {
		for (const item of config.productUsage) {
			const product = object(item);
			const productLabel = typeof product?.product === "string" ? XAI_PRODUCT_LABELS.get(product.product) : undefined;
			if (!productLabel) continue;
			windows.push({
				label: `${label} (${productLabel})`,
				remainingPercent: remaining(product?.usagePercent),
				resetsAt,
			});
		}
	}
	return { providerId: "xai", windows, checkedAt };
}

function codexAccountId(token: string): string | undefined {
	try {
		const parts = token.split(".");
		if (parts.length !== 3 || parts.some((part) => !part) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return undefined;
		const payload = object(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
		const claim = object(payload?.["https://api.openai.com/auth"])?.chatgpt_account_id;
		return typeof claim === "string" && /^[\x21-\x7e]{1,256}$/.test(claim) ? claim : undefined;
	} catch {
		return undefined;
	}
}

function retryAt(header: string | null, now: number): number {
	let wait = 60_000;
	if (header !== null && /^\d+$/.test(header.trim())) {
		const seconds = Number(header.trim());
		if (Number.isFinite(seconds)) wait = seconds * 1000;
	} else if (header && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(header)) {
		const date = Date.parse(header);
		if (Number.isFinite(date) && date > now) wait = date - now;
	}
	return now + Math.min(wait, 3_600_000);
}

/** Resolve OAuth through the configured runtime; never use configured endpoints or headers. */
export async function fetchSubscriptionUsage(
	registry: ModelRegistry,
	providerId: string,
	options: { signal: AbortSignal; timeoutMs?: number; now?: () => number },
): Promise<SubscriptionUsage> {
	options.signal.throwIfAborted();
	if (!SUPPORTED.has(providerId)) {
		throw new UsageFetchError({
			kind: "invalid_response",
			message: "Usage lookup is not available for this provider.",
		});
	}
	const now = options.now ?? Date.now;
	const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]);
	try {
		let auth;
		try {
			// A started refresh continues and persists its rotated token; only our wait is cancelled.
			auth = await raceWithAbortSignal(registry.getProviderAuth(providerId, { signal }), signal);
		} catch {
			signal.throwIfAborted();
			throw new UsageFetchError({ kind: "auth", message: `Sign-in could not be refreshed. Run /login ${providerId}.` });
		}
		if (auth?.source !== "OAuth" || !auth.auth.apiKey) {
			throw new UsageFetchError({
				kind: "auth",
				message: `Not signed in with a subscription. Run /login ${providerId}.`,
			});
		}
		const headers: Record<string, string> = {
			Authorization: `Bearer ${auth.auth.apiKey}`,
			Accept: "application/json",
			"User-Agent": getKnightcodeUserAgent(),
		};
		if (providerId === "anthropic") headers["anthropic-beta"] = "oauth-2025-04-20";
		else if (providerId === "openai-codex") {
			const accountId = codexAccountId(auth.auth.apiKey);
			if (!accountId)
				throw new UsageFetchError({
					kind: "auth",
					message: "Sign-in is missing account details. Run /login openai-codex.",
				});
			headers["ChatGPT-Account-Id"] = accountId;
			headers.originator = "knightcode";
		} else {
			headers["X-XAI-Token-Auth"] = "xai-grok-cli";
		}
		signal.throwIfAborted();
		const url =
			providerId === "anthropic"
				? "https://api.anthropic.com/api/oauth/usage"
				: providerId === "openai-codex"
					? "https://chatgpt.com/backend-api/wham/usage"
					: "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
		const response = await raceWithAbortSignal(
			fetch(url, { method: "GET", headers, redirect: "error", signal }),
			signal,
		);
		if (!response.ok) {
			// Error bodies are never used; release the connection without awaiting a slow body.
			void response.body?.cancel().catch(() => {});
			if (response.status === 401)
				throw new UsageFetchError({
					kind: "auth",
					message: `Sign-in expired or was revoked. Run /login ${providerId}.`,
				});
			if (response.status === 403)
				throw new UsageFetchError({ kind: "permission", message: "This sign-in cannot read usage." });
			if (response.status === 429) {
				const checkedAt = now();
				const retry = retryAt(response.headers.get("Retry-After"), checkedAt);
				throw new UsageFetchError({
					kind: "rate_limit",
					message: `Rate limited. Try again in ${formatUsageDuration(retry - checkedAt)}.`,
					retryAt: retry,
				});
			}
			throw new UsageFetchError({ kind: "network", message: `Usage service returned HTTP ${response.status}.` });
		}
		const text = await raceWithAbortSignal(response.text(), signal);
		let body: Record<string, unknown> | undefined;
		try {
			body = object(JSON.parse(text));
		} catch {}
		signal.throwIfAborted();
		if (!body)
			throw new UsageFetchError({
				kind: "invalid_response",
				message: "Usage service returned an unexpected response.",
			});
		const checkedAt = now();
		return providerId === "anthropic"
			? parseClaude(body, checkedAt)
			: providerId === "openai-codex"
				? parseCodex(body, checkedAt)
				: parseXai(body, checkedAt);
	} catch (error) {
		// Never retain an auth/fetch exception or response body as message, cause, or properties.
		if (options.signal.aborted) throw options.signal.reason;
		if (signal.aborted) throw new UsageFetchError({ kind: "timeout", message: "Usage lookup timed out." });
		if (error instanceof UsageFetchError) throw error;
		throw new UsageFetchError({ kind: "network", message: "Could not reach the usage service." });
	}
}
