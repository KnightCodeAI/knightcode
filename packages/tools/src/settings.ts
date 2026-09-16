import { Container, Input, type SettingItem, SettingsList, Spacer, Text } from "@knightcode/tui";
import { DynamicBorder, type ExtensionAPI, getSettingsListTheme, type Theme } from "@knightcodeai/cli";
import type { RegisteredToolEntry } from "./registry.ts";
import {
	applyActiveTools,
	currentMode,
	readPersisted,
	setMode,
	TOOL_MODES,
	type ToolMode,
	type ToolSettings,
	updateSettings,
} from "./state.ts";

export const MODE_LABELS: Record<ToolMode, string> = {
	off: "Disabled",
	session: "Enabled for this session",
	always: "Enabled by default",
};

/** What a settings row shows for a stored secret. */
export function maskKey(key: string): string {
	return `••••${key.length > 4 ? key.slice(-4) : ""}`;
}

/** A submenu with one text field: Enter submits (empty clears), Esc keeps the current value. */
export class TextSubmenu extends Container {
	private input: Input;

	constructor(
		theme: Theme,
		title: string,
		placeholder: string,
		onSubmit: (value: string) => void,
		onCancel: () => void,
	) {
		super();
		this.input = new Input({ placeholder, placeholderStyle: (text) => theme.fg("dim", text) });
		this.input.onSubmit = (value) => onSubmit(value.trim());
		this.input.onEscape = onCancel;
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.input);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter to save · Esc to go back"), 0, 0));
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}
}

class Panel extends Container {
	private list: SettingsList;

	constructor(list: SettingsList) {
		super();
		this.list = list;
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
	}
}

/**
 * The per-tool panel behind /tools: a Status row every tool has, plus whatever rows the registry
 * entry contributes. Rows are keyed by the setting they store; a change is persisted at once.
 */
export function toolSettingsPanel(
	entry: RegisteredToolEntry,
	entries: RegisteredToolEntry[],
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
	theme: Theme,
	done: () => void,
): Panel {
	const name = entry.tool.name;
	// One object the rows close over, so a submenu opened later sees earlier changes.
	const current: ToolSettings = { ...readPersisted()[name] };
	const items: SettingItem[] = [
		{
			id: "mode",
			label: "Status",
			currentValue: MODE_LABELS[currentMode(entry)],
			values: TOOL_MODES.map((mode) => MODE_LABELS[mode]),
		},
		...(entry.settings?.(current, theme) ?? []),
	];

	const list = new SettingsList(
		items,
		Math.min(items.length, 10),
		getSettingsListTheme(),
		(id, value) => {
			if (id === "mode") {
				const mode = TOOL_MODES.find((m) => MODE_LABELS[m] === value) ?? "off";
				void setMode(name, mode).then(() => applyActiveTools(pi, entries));
				return;
			}
			if (value === "") delete current[id];
			else current[id] = value;
			void updateSettings(name, { [id]: value === "" ? undefined : value });
			// The row shows the setting's display form (a masked key), not what the submenu returned.
			for (const item of entry.settings?.(current, theme) ?? []) list.updateValue(item.id, item.currentValue);
		},
		done,
	);

	const panel = new Panel(list);
	panel.addChild(new DynamicBorder());
	panel.addChild(new Spacer(1));
	panel.addChild(new Text(theme.bold(theme.fg("accent", name)), 1, 0));
	panel.addChild(new Spacer(1));
	panel.addChild(list);
	panel.addChild(new Spacer(1));
	panel.addChild(new DynamicBorder());
	return panel;
}
