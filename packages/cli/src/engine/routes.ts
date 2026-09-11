import { accountsRoutes } from "./accounts.ts";
import { completionsRoutes } from "./completions.ts";
import type { EngineContext } from "./context.ts";
import { eventsRoute } from "./events.ts";
import { modelsRoute } from "./models.ts";
import type { EngineRoute } from "./server.ts";
import { sessionRoutes } from "./session-routes.ts";
import type { SessionRegistry } from "./sessions.ts";

/**
 * Every route the engine serves. Both entrypoints build the list here, so an
 * adapter attached to the standalone engine and one that booted its own see
 * the same server.
 */
export function engineRoutes(ctx: EngineContext, sessions: SessionRegistry): readonly EngineRoute[] {
	return [
		eventsRoute(ctx.events),
		modelsRoute(ctx),
		...accountsRoutes(ctx),
		...completionsRoutes(ctx),
		...sessionRoutes(ctx, sessions),
	];
}
