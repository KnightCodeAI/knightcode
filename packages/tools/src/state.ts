import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@knightcodeai/cli";
import { getAgentDir } from "@knightcodeai/cli/config";

export type ToolMode = "off" | "session" | "always";
export const TOOL_MODES: ToolMode[] = ["off", "session", "always"];

/** Only tools the user has explicitly set appear here; a missing key means "the tool's own default". */
export type PersistedState = Record<string, boolean>;

export interface ToolEntry {
	tool: { name: string };
	defaultEnabled: boolean;
}

type ActiveToolsApi = Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">;

export function stateFile(): string {
	return join(getAgentDir(), "tools.json");
}

export function readPersisted(file = stateFile()): PersistedState {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const state: PersistedState = {};
		for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value === "boolean") state[name] = value;
		}
		return state;
	} catch {
		return {};
	}
}

export function writePersisted(state: PersistedState, file = stateFile()): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
	renameSync(tmp, file);
}

// Session overrides live for the process, so "enabled for this session" survives /new, /resume and /fork.
const sessionOverrides = new Map<string, boolean>();

export function resolveEnabled(
	name: string,
	defaultEnabled: boolean,
	persisted: PersistedState,
	overrides: ReadonlyMap<string, boolean> = sessionOverrides,
): boolean {
	return overrides.get(name) ?? persisted[name] ?? defaultEnabled;
}

export function setMode(name: string, mode: ToolMode, file = stateFile()): void {
	if (mode === "session") {
		sessionOverrides.set(name, true);
		return;
	}
	sessionOverrides.delete(name);
	const persisted = readPersisted(file);
	persisted[name] = mode === "always";
	writePersisted(persisted, file);
}

export function describeMode(entry: ToolEntry, persisted: PersistedState = readPersisted()): string {
	const name = entry.tool.name;
	if (sessionOverrides.get(name)) return "on (this session)";
	return (persisted[name] ?? entry.defaultEnabled) ? "on (default)" : "off";
}

/**
 * Reconciles the engine's active tool set with our state. Names the engine does not know
 * (a tool dropped by --tools/--exclude-tools) are ignored by setActiveTools, so adding is safe.
 */
export function applyActiveTools(
	pi: ActiveToolsApi,
	entries: ToolEntry[],
	persisted: PersistedState = readPersisted(),
): boolean {
	const active = new Set(pi.getActiveTools());
	let changed = false;
	for (const entry of entries) {
		const name = entry.tool.name;
		const enabled = resolveEnabled(name, entry.defaultEnabled, persisted);
		if (enabled && !active.has(name)) {
			active.add(name);
			changed = true;
		} else if (!enabled && active.has(name)) {
			active.delete(name);
			changed = true;
		}
	}
	if (changed) pi.setActiveTools([...active]);
	return changed;
}

/** Test seam: forget every session override. */
export function resetSessionOverrides(): void {
	sessionOverrides.clear();
}
