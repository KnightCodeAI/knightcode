import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@knightcodeai/cli";
import { getAgentDir } from "@knightcodeai/cli/config";
import lockfile from "proper-lockfile";

export type ToolMode = "off" | "session" | "always";
export const TOOL_MODES: ToolMode[] = ["off", "session", "always"];

/** A tool's settings; `enabled` is the toggle, everything else belongs to the tool (e.g. an API key). */
export type ToolSettings = Record<string, string | boolean>;

/** Only tools the user has explicitly set appear here; a missing `enabled` means "the tool's own default". */
export type PersistedState = Record<string, ToolSettings>;

export interface ToolEntry {
	tool: { name: string };
	defaultEnabled: boolean;
}

type ActiveToolsApi = Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">;

export function stateFile(): string {
	return join(getAgentDir(), "tools.json");
}

function parseSettings(value: unknown): ToolSettings | undefined {
	// A bare boolean is the pre-settings shape of the file.
	if (typeof value === "boolean") return { enabled: value };
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const settings: ToolSettings = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === "boolean" || (typeof entry === "string" && key !== "enabled")) settings[key] = entry;
	}
	return settings;
}

export function readPersisted(file = stateFile()): PersistedState {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const state: PersistedState = {};
		for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
			const settings = parseSettings(value);
			if (settings) state[name] = settings;
		}
		return state;
	} catch {
		return {};
	}
}

export function writePersisted(state: PersistedState, file = stateFile()): void {
	mkdirSync(dirname(file), { recursive: true });
	// Per-process temp name: two KnightCodes writing at once must not rename each other's file away.
	// Owner-only like auth.json, since a tool's settings can hold an API key.
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
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
	const enabled = persisted[name]?.enabled;
	return overrides.get(name) ?? (typeof enabled === "boolean" ? enabled : defaultEnabled);
}

/**
 * Merges `patch` into a tool's settings under the file lock; an undefined value deletes that key,
 * and a tool with nothing left is dropped from the file.
 */
export async function updateSettings(
	name: string,
	patch: Record<string, string | boolean | undefined>,
	file = stateFile(),
): Promise<void> {
	mkdirSync(dirname(file), { recursive: true });
	// The read-modify-write runs under the same kind of lock as settings.json, so two KnightCode
	// processes running /tools serialize instead of one overwriting the other's change. The lock
	// is on the directory so it works before the file exists.
	const release = await lockfile.lock(dirname(file), {
		lockfilePath: `${file}.lock`,
		realpath: false,
		retries: { retries: 10, minTimeout: 20 },
	});
	try {
		const persisted = readPersisted(file);
		const settings = { ...persisted[name] };
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) delete settings[key];
			else settings[key] = value;
		}
		if (Object.keys(settings).length === 0) delete persisted[name];
		else persisted[name] = settings;
		writePersisted(persisted, file);
	} finally {
		await release();
	}
}

export async function setMode(name: string, mode: ToolMode, file = stateFile()): Promise<void> {
	if (mode === "session") {
		sessionOverrides.set(name, true);
		return;
	}
	sessionOverrides.delete(name);
	await updateSettings(name, { enabled: mode === "always" }, file);
}

/** The mode /tools would show: a session override, else what the file (or the tool default) says. */
export function currentMode(entry: ToolEntry, persisted: PersistedState = readPersisted()): ToolMode {
	const name = entry.tool.name;
	if (sessionOverrides.get(name)) return "session";
	return resolveEnabled(name, entry.defaultEnabled, persisted, new Map()) ? "always" : "off";
}

export function describeMode(entry: ToolEntry, persisted: PersistedState = readPersisted()): string {
	return { off: "off", session: "on (this session)", always: "on (default)" }[currentMode(entry, persisted)];
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
