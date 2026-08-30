import type { OAuthCredential } from "../auth/types.ts";
import type { Model, ThinkingLevelMap } from "../types.ts";

// Radius is a third-party hosted service; its hostname is not ours to rebrand.
export const DEFAULT_RADIUS_GATEWAY = "https://radius.pi.dev";

export type RadiusGatewayModel = {
	id: string;
	name: string;
	reasoning: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
	input: ("text" | "image")[];
	cost: Model<"knightcode-messages">["cost"];
	contextWindow: number;
	maxTokens: number;
};

export type RadiusGatewayConfig = {
	baseUrl: string;
	models: RadiusGatewayModel[];
};

export type RadiusOAuthCredential = OAuthCredential & {
	gatewayConfig?: RadiusGatewayConfig;
};

/** `calculateCost` divides by each rate and iterates `tiers`, so both must be validated before use. */
function hasCostRates(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const cost = value as Record<string, unknown>;
	return ["input", "output", "cacheRead", "cacheWrite"].every((rate) => typeof cost[rate] === "number");
}

function isRadiusGatewayCost(value: unknown): boolean {
	if (!hasCostRates(value)) return false;
	const { tiers } = value as { tiers?: unknown };
	if (tiers === undefined) return true;
	return (
		Array.isArray(tiers) &&
		tiers.every(
			(tier) => hasCostRates(tier) && typeof (tier as { inputTokensAbove?: unknown }).inputTokensAbove === "number",
		)
	);
}

function isRadiusGatewayModel(value: unknown): value is RadiusGatewayModel {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const model = value as Partial<RadiusGatewayModel>;
	return (
		typeof model.id === "string" &&
		typeof model.name === "string" &&
		typeof model.reasoning === "boolean" &&
		Array.isArray(model.input) &&
		isRadiusGatewayCost(model.cost) &&
		typeof model.contextWindow === "number" &&
		typeof model.maxTokens === "number"
	);
}

function sanitizeRadiusGatewayConfig(config: unknown): RadiusGatewayConfig | undefined {
	if (typeof config !== "object" || config === null || Array.isArray(config)) return undefined;
	const { baseUrl, models } = config as Partial<RadiusGatewayConfig>;
	if (typeof baseUrl !== "string" || !Array.isArray(models)) return undefined;
	// Reject the whole config rather than filtering: a silently emptied catalog would be persisted
	// by the refresh in radius.ts and would wipe the cached models.
	if (!models.every(isRadiusGatewayModel)) return undefined;
	return {
		baseUrl,
		models: models.map((model) => ({ ...model })),
	};
}

export function normalizeRadiusGatewayUrl(value: string): string {
	const withScheme = /^https?:\/\//iu.test(value) ? value : `https://${value}`;
	return withScheme.replace(/\/+$/u, "");
}

export function getRadiusCredentialConfig(credential: OAuthCredential | undefined): RadiusGatewayConfig | undefined {
	return sanitizeRadiusGatewayConfig((credential as RadiusOAuthCredential | undefined)?.gatewayConfig);
}

export function getRadiusModelsFromConfig(
	providerId: string,
	config: RadiusGatewayConfig,
): Model<"knightcode-messages">[] {
	return config.models.map((model) => ({
		...model,
		api: "knightcode-messages",
		provider: providerId,
		baseUrl: config.baseUrl,
	}));
}

export function getRadiusModels(
	providerId: string,
	credential: OAuthCredential | undefined,
): Model<"knightcode-messages">[] {
	const config = getRadiusCredentialConfig(credential);
	return config ? getRadiusModelsFromConfig(providerId, config) : [];
}

function truncateHttpBody(body: string): string {
	const trimmed = body.trim();
	return trimmed.length > 512 ? `${trimmed.slice(0, 512)}…` : trimmed;
}

export async function loadRadiusGatewayConfig(
	gateway: string,
	apiKey?: string,
	signal?: AbortSignal,
): Promise<RadiusGatewayConfig> {
	const headers: Record<string, string> = { accept: "application/json" };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const response = await fetch(new URL("/v1/config", gateway), { headers, signal });
	if (!response.ok) {
		throw new Error(
			`Could not load Radius config from ${gateway}: ${response.status}: ${truncateHttpBody(await response.text())}`,
		);
	}
	const config = sanitizeRadiusGatewayConfig(await response.json());
	if (!config) throw new Error(`Invalid Radius config from ${gateway}`);
	return config;
}
