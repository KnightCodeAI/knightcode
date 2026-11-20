/** App-server endpoints for frontend-only native artifacts, consent and per-window diagnostics. */
import type { AppServerContext } from "../context.ts";
import { AppServerError } from "../errors.ts";
import type { Handlers } from "../server.ts";
import { DesktopExtensionManager } from "./manager.ts";
import { startDesktopControl } from "./control.ts";
import { DesktopDevelopmentWatcher } from "./watch.ts";
import { DesktopBackendRuntime } from "./runtime.ts";

const hosts = new WeakMap<AppServerContext, Handlers>();

export function desktopExtensionHandlers(ctx: AppServerContext): Handlers {
	const existing = hosts.get(ctx);
	if (existing) return existing;
	const manager = new DesktopExtensionManager(ctx.agentDir, {
		safeMode: process.env.KNIGHTCODE_DESKTOP_SAFE_MODE === "1",
		...(process.env.KNIGHTCODE_DESKTOP_VERSION ? { appVersion: process.env.KNIGHTCODE_DESKTOP_VERSION } : {}),
	});
	const runtime = new DesktopBackendRuntime(manager, ctx);
	ctx.onDispose(() => runtime.dispose());
	const reload = (cause: "source" | "explicit") => {
		ctx.broadcast("desktopExtension/changed", { reload: true });
		void runtime
			.reconcile(undefined, cause === "explicit")
			.catch((error: unknown) => process.stderr.write(`Desktop extension reload: ${String(error)}\n`));
	};
	const watcher = new DesktopDevelopmentWatcher(() => reload("source"));
	ctx.onDispose(() => watcher.dispose());
	if (process.env.KNIGHTCODE_CLIENT === "desktop") {
		void startDesktopControl(ctx.agentDir, manager, () => reload("explicit"))
			.then((close) => ctx.onDispose(close))
			.catch((error: unknown) => process.stderr.write(`Desktop authoring controls: ${String(error)}\n`));
	}
	const handlers: Handlers = {
		"desktopExtension/window/connect": async (params, connection) => {
			await runtime.connect(params, connection);
			return {};
		},
		"desktopExtension/window/disconnect": async (params, connection) => {
			runtime.disconnect(params, connection);
			return {};
		},
		"desktopExtension/reconcile": async (params, connection) => {
			await runtime.reconcileWindow(params, connection);
			return {};
		},
		"desktopExtension/ack": async (params, connection) => {
			runtime.ack(params, connection);
			return {};
		},
		"desktopExtension/fail": async (params, connection) => {
			runtime.fail(params, connection);
			return {};
		},
		"desktopExtension/call": async (params, connection) => runtime.call(params, connection),
		"desktopExtension/cancel": async (params, connection) => {
			runtime.cancel(params, connection);
			return {};
		},
		"desktopExtension/subscribe": async (params, connection) => runtime.subscribe(params, connection),
		"desktopExtension/unsubscribe": async (params, connection) => {
			runtime.unsubscribe(params, connection);
			return {};
		},
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
			await runtime.reconcile(params.cwd);
			return {};
		},
		// Off retires every live owner in every window through the coordinator; on activates approved ones again.
		"desktopExtension/preview/set": async ({ enabled }) => {
			manager.setPreview(enabled);
			watcher.update(await manager.list());
			ctx.broadcast("desktopExtension/changed", {});
			await runtime.reconcile(undefined, enabled);
			return {};
		},
		"desktopExtension/reload": async () => {
			ctx.broadcast("desktopExtension/changed", { reload: true });
			await runtime.reconcile(undefined, true);
			return {};
		},
		"desktopExtension/diagnostic": async ({ owner, diagnostic }) => {
			manager.report(owner, diagnostic);
			return {};
		},
	};
	hosts.set(ctx, handlers);
	return handlers;
}
