/** App-server endpoints for frontend-only native artifacts, consent and per-window diagnostics. */
import type { AppServerContext } from "../context.ts";
import { AppServerError } from "../errors.ts";
import type { Handlers } from "../server.ts";
import { DesktopExtensionManager } from "./manager.ts";

export function desktopExtensionHandlers(ctx: AppServerContext): Handlers {
	const manager = new DesktopExtensionManager(ctx.agentDir, {
		safeMode: process.env.KNIGHTCODE_DESKTOP_SAFE_MODE === "1",
	});
	return {
		"desktopExtension/list": async ({ cwd }) => manager.list(cwd),
		"desktopExtension/set": async (params) => {
			try {
				await manager.set(params);
			} catch (error) {
				throw new AppServerError("invalidParams", error instanceof Error ? error.message : String(error));
			}
			ctx.broadcast("desktopExtension/changed", {});
			return {};
		},
		"desktopExtension/reload": async () => {
			ctx.broadcast("desktopExtension/changed", { reload: true });
			return {};
		},
		"desktopExtension/diagnostic": async ({ owner, diagnostic }) => {
			manager.report(owner, diagnostic);
			return {};
		},
	};
}
