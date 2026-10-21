import { type ClientIdentity, KNIGHTCODE_ATTRIBUTION } from "@knightcode/ai";
import { VERSION } from "../config.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { isInstallTelemetryEnabled } from "./telemetry.ts";

/**
 * How KnightCode's requests identify it to providers: a detailed `User-Agent` with KnightCode's version, and attribution to KnightCode as a
 * CLI agent while install telemetry is enabled.
 */
export function getClientIdentity(settingsManager: SettingsManager): ClientIdentity {
	return {
		userAgent: "detailed",
		version: VERSION,
		attribution: isInstallTelemetryEnabled(settingsManager) ? KNIGHTCODE_ATTRIBUTION : null,
	};
}
