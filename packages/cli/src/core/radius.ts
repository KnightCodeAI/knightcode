import { DEFAULT_RADIUS_GATEWAY, normalizeRadiusGatewayUrl } from "@knightcode/ai/providers/radius-config";

export const RADIUS_PROVIDER_ID = "radius";
export const ENV_RADIUS_GATEWAY = "KNIGHTCODE_RADIUS_GATEWAY";

/** Radius gateway origin, honoring the `KNIGHTCODE_RADIUS_GATEWAY` override. */
export function getRadiusGatewayUrl(): string {
	return normalizeRadiusGatewayUrl(process.env[ENV_RADIUS_GATEWAY] ?? DEFAULT_RADIUS_GATEWAY);
}
