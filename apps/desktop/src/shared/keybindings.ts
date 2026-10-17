/**
 * Desktop keybindings (desktop-shell.md section 10). Components register handlers against ids;
 * nothing compares keys directly. `mod` is Ctrl on Windows and Linux, Cmd on macOS.
 */

export interface KeybindingDefinition {
	defaultKeys: string[];
	description: string;
}

export const DESKTOP_KEYBINDINGS = {
	"desktop.palette": { defaultKeys: ["mod+k", "mod+shift+p"], description: "Open the command palette" },
	"desktop.settings": { defaultKeys: ["mod+,"], description: "Open settings" },
	"desktop.nav.back": { defaultKeys: ["alt+arrowleft"], description: "Go back" },
	"desktop.nav.forward": { defaultKeys: ["alt+arrowright"], description: "Go forward" },
	"desktop.thread.new": { defaultKeys: ["mod+n"], description: "New thread" },
	"desktop.thread.archive": { defaultKeys: ["mod+shift+a"], description: "Archive the thread" },
	"desktop.project.open": { defaultKeys: ["mod+o"], description: "Add a project folder" },
	"desktop.sidebar.toggle": { defaultKeys: ["mod+b"], description: "Toggle the sidebar" },
	"desktop.turn.interrupt": { defaultKeys: ["escape"], description: "Stop the running turn" },
	"desktop.composer.send": { defaultKeys: ["enter"], description: "Send the message" },
	"desktop.composer.newline": { defaultKeys: ["shift+enter"], description: "Insert a new line" },
	"desktop.composer.steer": { defaultKeys: ["mod+enter"], description: "Steer the running turn" },
	"desktop.item.activate": { defaultKeys: ["enter"], description: "Open the focused item or confirm an edit" },
	"desktop.picker.next": { defaultKeys: ["arrowdown"], description: "Next suggestion" },
	"desktop.picker.previous": { defaultKeys: ["arrowup"], description: "Previous suggestion" },
	"desktop.picker.accept": { defaultKeys: ["enter", "tab"], description: "Insert the suggestion" },
	"desktop.picker.dismiss": { defaultKeys: ["escape"], description: "Close suggestions" },
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
	if (wants.has("shift") !== event.shiftKey || wants.has("alt") !== event.altKey) return false;
	// Off macOS `ctrl` is another name for `mod`, and `meta` is the Windows or Super key.
	const ctrl = mac ? wants.has("ctrl") : wants.has("mod") || wants.has("ctrl");
	const meta = mac ? wants.has("mod") : wants.has("meta");
	if (ctrl !== event.ctrlKey || meta !== event.metaKey) return false;
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
