// Per-connector permissions (spec sections 9 and 13): reads, writes and individual tools are each Auto review, Needs
// approval or Blocked, and feed the approval decision. A tool counts as a read only when its server marks it
// read-only; anything else is a write, so an unmarked tool never slips through as harmless.
import type { ConnectorPermissions, PermissionLevel } from "@knightcode/bots-protocol";

/** What a new connection starts with: reads run under review, writes ask. */
export const DEFAULT_PERMISSIONS: ConnectorPermissions = { reads: "auto", writes: "approval", tools: {} };

export interface ConnectorTool {
	name: string;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export const isRead = (tool: ConnectorTool) => tool.annotations?.readOnlyHint === true;

/** The tool's own setting, else its kind's. */
export function permissionFor(permissions: ConnectorPermissions, tool: ConnectorTool): PermissionLevel {
	return permissions.tools[tool.name] ?? (isRead(tool) ? permissions.reads : permissions.writes);
}

/**
 * How a connector call goes before the bot's approval mode is applied: refused outright, sent to the user, or left to
 * the mode (Never ask, Auto review with the reviewer, or Ask).
 */
export function connectorGate(level: PermissionLevel): "refuse" | "ask" | "mode" {
	return level === "blocked" ? "refuse" : level === "approval" ? "ask" : "mode";
}
