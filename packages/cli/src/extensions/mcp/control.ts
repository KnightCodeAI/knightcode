/**
 * The MCP extension's servers for other extensions, over the session's event bus. `/plugins` reads each plugin
 * server's state for its rows and opens `/mcp`'s own menus for them, so signing in, reconnecting and turning a server
 * on or off stay in one place.
 */

import type { EventBus } from "../../core/event-bus.ts";
import type { ExtensionContext } from "../../core/extensions/types.ts";
import type { McpUi } from "./ui.ts";

export const MCP_CONTROL_CHANNEL = "mcp-control";

export type McpServerState =
	"disabled" | "starting" | "connecting" | "connected" | "needs-auth" | "failed" | "disconnected";

export interface McpServerSummary {
	name: string;
	state: McpServerState;
	tools: number;
}

export interface McpControl {
	list(): McpServerSummary[];
	/** Calls `listener` whenever a server's state changes. Returns the unsubscribe function. */
	subscribe(listener: () => void): () => void;
	/**
	 * Runs `/mcp`'s menus on `ui` for `names`: one server's menu, or a list of several. Resolves when the user
	 * leaves them. With one server, `action` (a value of its menu, such as `signin`) runs before the menu shows.
	 */
	manage(names: readonly string[], ui: McpUi, ctx: ExtensionContext, action?: string): Promise<void>;
}

/** The MCP extension's control, or undefined when it is not loaded (`--no-mcp`). */
export function getMcpControl(bus: EventBus): McpControl | undefined {
	let control: McpControl | undefined;
	// The bus calls handlers synchronously, so the MCP extension provides before emit returns.
	bus.emit(MCP_CONTROL_CHANNEL, { provide: (provided: McpControl) => (control = provided) });
	return control;
}
