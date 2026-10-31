import { createHash } from "node:crypto";
import { getKnightcodeUserAgent } from "../utils/user-agent.ts";
import type { SettingsManager } from "./settings-manager.ts";

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isInstallTelemetryEnabled(
	settingsManager: SettingsManager,
	telemetryEnv: string | undefined = process.env.KNIGHTCODE_TELEMETRY,
): boolean {
	return telemetryEnv !== undefined ? isTruthyEnvFlag(telemetryEnv) : settingsManager.getEnableInstallTelemetry();
}

/**
 * Anonymous install ID for telemetry: a salted one-way hash of the device ID, so the raw ID (which
 * other services receive) never reaches knightcode.dev and the two cannot be joined.
 */
export function telemetryInstallId(deviceId: string): string {
	return createHash("sha256").update(`knightcode-telemetry:${deviceId}`).digest("hex").slice(0, 32);
}

/**
 * Ping knightcode.dev/api/report-install. No `active`: an install/update. With `active`: one launch
 * of that client, which PostHog turns into DAU/WAU/MAU per client. The response is ignored.
 */
export function reportTelemetry(settingsManager: SettingsManager, version: string, active?: "cli" | "desktop"): void {
	if (process.env.KNIGHTCODE_OFFLINE || !isInstallTelemetryEnabled(settingsManager)) return;
	const query = new URLSearchParams({ version, id: telemetryInstallId(settingsManager.getOrCreateDeviceId()) });
	if (active) query.set("active", active);
	void fetch(`https://knightcode.dev/api/report-install?${query}`, {
		headers: { "User-Agent": getKnightcodeUserAgent(version) },
		signal: AbortSignal.timeout(5000),
	}).catch(() => undefined);
}
