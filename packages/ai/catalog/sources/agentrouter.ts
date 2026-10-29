// AgentRouter's rate table: the model list and per-token prices of its new-api deployment.

const AGENTROUTER_API_URL = "https://agentrouter.org";

/** One entry of AgentRouter's `/api/pricing`. */
export interface AgentRouterPricingModel {
	model_name: string;
	quota_type?: number;
	model_ratio?: number;
	completion_ratio?: number;
	supported_endpoint_types?: string[];
}

/** AgentRouter's rate table: priced models and the units their ratios are denominated in. */
export interface AgentRouterRates {
	/** Quota units per US dollar (`/api/status`). */
	quotaPerUnit: number;
	/** The default group's price multiplier. */
	groupRatio: number;
	models: AgentRouterPricingModel[];
}

/**
 * AgentRouter's API is not reachable from every network: CI runners get HTTP 200 with an HTML
 * interstitial rather than the payload, which `response.ok` does not catch. Read the body as text so
 * the failure names what came back instead of surfacing a bare JSON SyntaxError.
 */
async function fetchAgentRouterJson<T>(path: string): Promise<T> {
	const response = await fetch(`${AGENTROUTER_API_URL}${path}`);
	if (!response.ok) throw new Error(`AgentRouter ${path} returned ${response.status}`);
	const body = await response.text();
	try {
		return JSON.parse(body) as T;
	} catch {
		const contentType = response.headers.get("content-type") ?? "no content-type";
		throw new Error(
			`AgentRouter ${path} returned ${contentType}, not JSON: ${body.slice(0, 120).replace(/\s+/g, " ")}`,
		);
	}
}

/**
 * AgentRouter is a new-api deployment. Its two public endpoints are the authoritative model list and
 * price table: `/api/pricing` carries model_ratio / completion_ratio per model, `/api/status` the
 * quota_per_unit those ratios are denominated in.
 */
export async function fetchAgentRouterRates(): Promise<AgentRouterRates> {
	const status = await fetchAgentRouterJson<{ data?: { quota_per_unit?: number } }>("/api/status");
	const quotaPerUnit = status.data?.quota_per_unit;
	if (typeof quotaPerUnit !== "number" || !Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
		throw new Error("AgentRouter /api/status returned no usable quota_per_unit");
	}
	const pricing = await fetchAgentRouterJson<{
		data?: AgentRouterPricingModel[];
		group_ratio?: Record<string, number>;
	}>("/api/pricing");
	const groupRatio = pricing.group_ratio?.default ?? 1;
	if (!Number.isFinite(groupRatio) || groupRatio <= 0) {
		throw new Error("AgentRouter /api/pricing returned no usable default group_ratio");
	}
	return { quotaPerUnit, groupRatio, models: pricing.data ?? [] };
}
