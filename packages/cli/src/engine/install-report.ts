/**
 * The IDE's install ping.
 *
 * It lives here, not in Rust, because the shared opt-out already lives here:
 * one `enableInstallTelemetry` governs both front doors, the way one
 * `auth.json` governs both logins. It is the same anonymous route the CLI
 * pings (`reportInstallTelemetry` in
 * `../modes/interactive/interactive-mode.ts`), so the IDE joins the funnel the
 * CLI already feeds rather than growing a second one: no write key in the
 * client, and no identity in the payload — the route derives a distinct id from
 * the connecting address and the user agent and stores neither.
 *
 * Nothing is reported for a CLI user or for the ACP adapter: this returns
 * immediately unless the IDE set `KNIGHTCODE_IDE_VERSION` in the engine's
 * environment.
 */

import { isInstallTelemetryEnabled } from "../core/telemetry.ts";
import { getProductUserAgent } from "../utils/user-agent.ts";
import type { EngineContext } from "./context.ts";

const REPORT_URL = "https://knightcode.dev/api/report-install";
const TIMEOUT_MS = 5000;

/**
 * Fire-and-forget: callers `void` this and the engine's readiness never waits
 * on it. Rejections are swallowed — an analytics request is not a failure mode
 * the engine has an answer for.
 */
export async function reportIdeInstall(ctx: Pick<EngineContext, "settings">): Promise<void> {
	const version = process.env.KNIGHTCODE_IDE_VERSION;
	if (!version) return;
	if (process.env.KNIGHTCODE_OFFLINE) return;

	// The CLI may have changed either key since the engine started, and the
	// engine outlives no one's settings edits.
	await ctx.settings.reload().catch(() => undefined);

	if (!isInstallTelemetryEnabled(ctx.settings)) return;

	// Once per IDE version, not once per start: the engine restarts, which is
	// why `KNIGHTCODE_ENGINE_PORT` pinning exists at all.
	if (ctx.settings.getLastIdeVersion() === version) return;
	ctx.settings.setLastIdeVersion(version);

	await fetch(`${REPORT_URL}?version=${encodeURIComponent(version)}`, {
		headers: { "User-Agent": getProductUserAgent("knightcode-ide", version) },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
		.then(() => undefined)
		.catch(() => undefined);
}
