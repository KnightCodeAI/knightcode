/**
 * Desktop keybindings (desktop-shell.md section 10). Components register handlers against ids;
 * nothing compares keys directly. `mod` is Ctrl on Windows and Linux, Cmd on macOS.
 */

export interface KeybindingDefinition {
	defaultKeys: string[];
	description: string;
}

export const DESKTOP_KEYBINDINGS = {
	"desktop.thread.new": { defaultKeys: ["mod+n"], description: "New thread" },
	"desktop.project.open": { defaultKeys: ["mod+o"], description: "Add a project folder" },
	"desktop.sidebar.toggle": { defaultKeys: ["mod+b"], description: "Toggle the sidebar" },
	"desktop.turn.interrupt": { defaultKeys: ["escape"], description: "Stop the running turn" },
	"desktop.composer.send": { defaultKeys: ["enter"], description: "Send the message" },
	"desktop.composer.newline": { defaultKeys: ["shift+enter"], description: "Insert a new line" },
	"desktop.composer.steer": { defaultKeys: ["mod+enter"], description: "Steer the running turn" },
	"desktop.approval.accept": { defaultKeys: ["enter"], description: "Allow the request once" },
	"desktop.approval.decline": { defaultKeys: ["escape"], description: "Deny the request" },
} as const satisfies Record<string, KeybindingDefinition>;

export type KeybindingId = keyof typeof DESKTOP_KEYBINDINGS;

interface KeyLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

function matchesKeys(event: KeyLike, keys: string, mac: boolean): boolean {
	const parts = keys.toLowerCase().split("+");
	const key = parts.pop()!;
	const wants = new Set(parts);
	const mod = mac ? event.metaKey : event.ctrlKey;
	const ctrl = mac ? event.ctrlKey : false;
	if (wants.has("mod") !== mod || wants.has("shift") !== event.shiftKey || wants.has("alt") !== event.altKey)
		return false;
	if (wants.has("ctrl") !== ctrl) return false;
	return event.key.toLowerCase() === key;
}

export function matchesBinding(
	event: KeyLike,
	id: KeybindingId,
	mac: boolean,
	overrides: Partial<Record<KeybindingId, string[]>> = {},
): boolean {
	const keys = overrides[id] ?? DESKTOP_KEYBINDINGS[id].defaultKeys;
	return keys.some((k) => matchesKeys(event, k, mac));
}
