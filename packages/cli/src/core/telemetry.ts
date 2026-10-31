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
 * Install ID for telemetry: a one-way hash of the device ID, so the raw ID (which OpenAI also
 * receives) is never sent to knightcode.dev. The prefix is public, so anyone holding the raw ID
 * can recompute this one; it hides the ID, it does not make the two unlinkable.
 */
export function telemetryInstallId(deviceId: string): string {
	return createHash("sha256").update(`knightcode-telemetry:${deviceId}`).digest("hex").slice(0, 32);
}

/**
 * Ping knightcode.dev/api/report-install. No `active`: an install/update. With `active`: one launch
 * of that client, which PostHog turns into DAU/WAU/MAU per client. The CLI reports interactive
 * sessions only, so print-mode runs from scripts and CI do not count as users. The response is ignored.
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
