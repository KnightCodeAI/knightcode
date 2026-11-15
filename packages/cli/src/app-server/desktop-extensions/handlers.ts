/** App-server endpoints for frontend-only native artifacts, consent and per-window diagnostics. */
import type { AppServerContext } from "../context.ts";
import { AppServerError } from "../errors.ts";
import type { Handlers } from "../server.ts";
import { DesktopExtensionManager } from "./manager.ts";
import { startDesktopControl } from "./control.ts";
import { DesktopDevelopmentWatcher } from "./watch.ts";

export function desktopExtensionHandlers(ctx: AppServerContext): Handlers {
	const manager = new DesktopExtensionManager(ctx.agentDir, {
		safeMode: process.env.KNIGHTCODE_DESKTOP_SAFE_MODE === "1",
	});
	const reload = () => ctx.broadcast("desktopExtension/changed", { reload: true });
	const watcher = new DesktopDevelopmentWatcher(reload);
	ctx.onDispose(() => watcher.dispose());
	if (process.env.KNIGHTCODE_CLIENT === "desktop") {
		void startDesktopControl(ctx.agentDir, manager, reload)
			.then((close) => ctx.onDispose(close))
			.catch((error: unknown) => process.stderr.write(`Desktop authoring controls: ${String(error)}\n`));
	}
	return {
		"desktopExtension/list": async ({ cwd }) => {
			const status = await manager.list(cwd);
			watcher.update(status);
			return status;
		},
		"desktopExtension/set": async (params) => {
			try {
				await manager.set(params);
			} catch (error) {
				throw new AppServerError("invalidParams", error instanceof Error ? error.message : String(error));
			}
			watcher.update(await manager.list(params.cwd));
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
