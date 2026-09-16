import type { ExtensionAPI, ExtensionCommandContext } from "@knightcodeai/cli";
import { type RegisteredToolEntry, TOOLS } from "./registry.ts";
import { applyActiveTools, describeMode, readPersisted, setMode, TOOL_MODES, type ToolMode } from "./state.ts";

export const MODE_LABELS: Record<ToolMode, string> = {
	off: "Disabled",
	session: "Enabled for this session",
	always: "Enabled by default",
};

/** Command-line spellings: `on` means this session; `always` persists. */
export const ARG_MODES: Record<string, ToolMode> = { off: "off", on: "session", always: "always" };

type ActiveToolsApi = Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">;

export async function toolsCommand(
	args: string,
	ctx: ExtensionCommandContext,
	pi: ActiveToolsApi,
	entries: RegisteredToolEntry[] = TOOLS,
): Promise<void> {
	const [rawName, rawMode, extra] = args.trim().split(/\s+/).filter(Boolean);
	const names = entries.map((e) => e.tool.name);
	const badName = rawName !== undefined && !names.includes(rawName);
	const badMode = rawMode !== undefined && !(rawMode in ARG_MODES);
	if (extra !== undefined || badName || badMode) {
		ctx.ui.notify(`Usage: /tools [${names.join("|")}] [${Object.keys(ARG_MODES).join("|")}]`, "error");
		return;
	}

	let entry = entries.find((e) => e.tool.name === rawName);
	if (!entry) {
		const persisted = readPersisted();
		const labels = entries.map((e) => `${e.tool.name} — ${describeMode(e, persisted)}`);
		const picked = await ctx.ui.select("Tools", labels);
		if (picked === undefined) return;
		entry = entries[labels.indexOf(picked)];
	}

	let mode: ToolMode | undefined = rawMode === undefined ? undefined : ARG_MODES[rawMode];
	if (mode === undefined) {
		const picked = await ctx.ui.select(
			entry.tool.name,
			TOOL_MODES.map((m) => MODE_LABELS[m]),
		);
		if (picked === undefined) return;
		mode = TOOL_MODES.find((m) => MODE_LABELS[m] === picked);
		if (mode === undefined) return;
	}

	await setMode(entry.tool.name, mode);
	applyActiveTools(pi, entries);
	ctx.ui.notify(`${entry.tool.name}: ${describeMode(entry)}`, "info");
}

export function toolsCompletions(
	prefix: string,
	entries: RegisteredToolEntry[] = TOOLS,
): Array<{ value: string; label: string }> {
	const [name = "", mode] = prefix.split(/\s+/);
	if (mode === undefined) {
		return entries
			.map((e) => e.tool.name)
			.filter((n) => n.startsWith(name))
			.map((n) => ({ value: n, label: n }));
	}
	return Object.keys(ARG_MODES)
		.filter((m) => m.startsWith(mode))
		.map((m) => ({ value: `${name} ${m}`, label: m }));
}
