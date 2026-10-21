/**
 * Desktop keybindings (desktop-shell.md section 10). Components register handlers against ids;
 * nothing compares keys directly. `mod` is Ctrl on Windows and Linux, Cmd on macOS. Defaults follow the
 * Codex desktop app's where both apps have the action (its Settings › Keyboard shortcuts, 2026-10-19); the first
 * combination is the one menus show.
 *
 * Punctuation and digit keys are named by their physical key (`bracketleft`, `equal`, `digit1`) and match
 * `KeyboardEvent.code`, so Shift and the keyboard layout do not change what they mean: Ctrl+Shift+= is still
 * "equal" though its key is "+".
 */

export interface KeybindingDefinition {
	defaultKeys: string[];
	description: string;
}

export const DESKTOP_KEYBINDINGS = {
	"desktop.palette": { defaultKeys: ["mod+k", "mod+shift+p"], description: "Open the command palette" },
	"desktop.settings": { defaultKeys: ["mod+comma"], description: "Open settings" },
	"desktop.shortcuts": { defaultKeys: ["mod+slash"], description: "Show keyboard shortcuts" },
	"desktop.nav.back": { defaultKeys: ["mod+bracketleft", "alt+arrowleft"], description: "Go back" },
	"desktop.nav.forward": { defaultKeys: ["mod+bracketright", "alt+arrowright"], description: "Go forward" },
	"desktop.thread.new": { defaultKeys: ["mod+n", "mod+shift+o"], description: "New thread" },
	"desktop.thread.archive": { defaultKeys: ["mod+shift+a"], description: "Archive the thread" },
	"desktop.thread.rename": { defaultKeys: ["mod+alt+r"], description: "Rename the thread" },
	"desktop.thread.pin": { defaultKeys: ["mod+alt+p"], description: "Pin or unpin the thread" },
	"desktop.thread.copyCwd": { defaultKeys: ["mod+shift+c"], description: "Copy the working directory" },
	"desktop.thread.markUnread": { defaultKeys: ["mod+shift+u"], description: "Mark the thread as unread" },
	"desktop.thread.clearUnread": { defaultKeys: ["shift+escape"], description: "Mark all threads as read" },
	"desktop.thread.copyDeeplink": { defaultKeys: ["mod+alt+l"], description: "Copy a link to the thread" },
	"desktop.thread.copyPath": { defaultKeys: ["mod+alt+shift+c"], description: "Copy the conversation path" },
	"desktop.thread.copyCode": { defaultKeys: ["mod+shift+semicolon"], description: "Copy the last code block" },
	// Unassigned in Codex too; Settings › Keyboard shortcuts can give them keys.
	"desktop.thread.fork": { defaultKeys: [], description: "Fork the thread" },
	"desktop.thread.openWindow": { defaultKeys: [], description: "Open the thread in a new window" },
	"desktop.thread.delete": { defaultKeys: [], description: "Delete the thread" },
	"desktop.thread.nextAttention": {
		defaultKeys: ["mod+alt+a"],
		description: "Next thread waiting on you or with unread activity",
	},
	"desktop.thread.next": {
		defaultKeys: ["mod+alt+bracketright", "mod+alt+arrowright"],
		description: "Next sidebar item",
	},
	"desktop.thread.previous": {
		defaultKeys: ["mod+alt+bracketleft", "mod+alt+arrowleft"],
		description: "Previous sidebar item",
	},
	// Codex's "Go to recent chat N": the Nth most recently updated thread, wherever the sidebar shows it.
	"desktop.thread.recent1": { defaultKeys: ["mod+alt+digit1"], description: "Go to recent thread 1" },
	"desktop.thread.recent2": { defaultKeys: ["mod+alt+digit2"], description: "Go to recent thread 2" },
	"desktop.thread.recent3": { defaultKeys: ["mod+alt+digit3"], description: "Go to recent thread 3" },
	"desktop.thread.recent4": {
		defaultKeys: ["mod+alt+digit4", "mod+shift+digit9"],
		description: "Go to recent thread 4",
	},
	"desktop.thread.recent5": {
		defaultKeys: ["mod+alt+digit5", "mod+shift+digit8"],
		description: "Go to recent thread 5",
	},
	"desktop.thread.recent6": { defaultKeys: ["mod+alt+digit6"], description: "Go to recent thread 6" },
	"desktop.thread.find": { defaultKeys: ["mod+f"], description: "Find in the thread" },
	"desktop.find.next": { defaultKeys: ["enter", "f3"], description: "Next result" },
	"desktop.find.previous": { defaultKeys: ["shift+enter", "shift+f3"], description: "Previous result" },
	// Codex's "Go to chat N": the Nth thread as the sidebar shows them (sidebar-model.ts, threadSlots).
	"desktop.thread.goTo1": { defaultKeys: ["alt+digit1"], description: "Go to thread 1" },
	"desktop.thread.goTo2": { defaultKeys: ["alt+digit2"], description: "Go to thread 2" },
	"desktop.thread.goTo3": { defaultKeys: ["alt+digit3"], description: "Go to thread 3" },
	"desktop.thread.goTo4": { defaultKeys: ["alt+digit4"], description: "Go to thread 4" },
	"desktop.thread.goTo5": { defaultKeys: ["alt+digit5"], description: "Go to thread 5" },
	"desktop.thread.goTo6": { defaultKeys: ["alt+digit6"], description: "Go to thread 6" },
	"desktop.thread.goTo7": { defaultKeys: ["alt+digit7"], description: "Go to thread 7" },
	"desktop.thread.goTo8": { defaultKeys: ["alt+digit8"], description: "Go to thread 8" },
	"desktop.thread.goTo9": { defaultKeys: ["alt+digit9"], description: "Go to thread 9" },
	"desktop.project.open": { defaultKeys: ["mod+o"], description: "Add a project folder" },
	"desktop.sidebar.toggle": { defaultKeys: ["mod+b", "mod+shift+s"], description: "Toggle the sidebar" },
	"desktop.panel.toggle": { defaultKeys: ["mod+shift+g"], description: "Toggle the Changes panel" },
	"desktop.view.zoomIn": { defaultKeys: ["mod+shift+equal", "mod+equal", "mod+numpadadd"], description: "Zoom in" },
	"desktop.view.zoomOut": { defaultKeys: ["mod+minus", "mod+numpadsubtract"], description: "Zoom out" },
	"desktop.view.zoomReset": { defaultKeys: ["mod+digit0"], description: "Actual size" },
	"desktop.view.fullScreen": { defaultKeys: ["f11"], description: "Toggle full screen" },
	"desktop.app.quit": { defaultKeys: ["mod+q"], description: "Quit KnightCode" },
	"desktop.window.close": { defaultKeys: ["mod+w"], description: "Close the window" },
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

/** The go-to-thread bindings, slot by slot (slot 1 first). */
export const GO_TO_THREAD = [
	"desktop.thread.goTo1",
	"desktop.thread.goTo2",
	"desktop.thread.goTo3",
	"desktop.thread.goTo4",
	"desktop.thread.goTo5",
	"desktop.thread.goTo6",
	"desktop.thread.goTo7",
	"desktop.thread.goTo8",
	"desktop.thread.goTo9",
] as const satisfies readonly KeybindingId[];

/** The go-to-recent-thread bindings, most recent first. */
export const GO_TO_RECENT = [
	"desktop.thread.recent1",
	"desktop.thread.recent2",
	"desktop.thread.recent3",
	"desktop.thread.recent4",
	"desktop.thread.recent5",
	"desktop.thread.recent6",
] as const satisfies readonly KeybindingId[];

interface KeyLike {
	key: string;
	/** The physical key; matched for punctuation names (see the file comment). */
	code?: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/** Key names that mean a physical key, compared with `KeyboardEvent.code` (lowercased). */
export const CODE_KEYS = new Set([
	"bracketleft",
	"bracketright",
	"equal",
	"minus",
	"slash",
	"semicolon",
	"backquote",
	"comma",
	"numpadadd",
	"numpadsubtract",
	"digit0",
	"digit1",
	"digit2",
	"digit3",
	"digit4",
	"digit5",
	"digit6",
	"digit7",
	"digit8",
	"digit9",
]);

function matchesKeys(event: KeyLike, keys: string, mac: boolean): boolean {
	const parts = keys.toLowerCase().split("+");
	const key = parts.pop()!;
	const wants = new Set(parts);
	if (wants.has("shift") !== event.shiftKey || wants.has("alt") !== event.altKey) return false;
	// Off macOS `ctrl` is another name for `mod`, and `meta` is the Windows or Super key.
	const ctrl = mac ? wants.has("ctrl") : wants.has("mod") || wants.has("ctrl");
	const meta = mac ? wants.has("mod") : wants.has("meta");
	if (ctrl !== event.ctrlKey || meta !== event.metaKey) return false;
	if (CODE_KEYS.has(key)) return event.code?.toLowerCase() === key;
	// With Alt, macOS's Option and AltGr layouts type a character (⌥R is "®"): letters match their physical key.
	if (wants.has("alt") && /^[a-z]$/.test(key)) return event.code?.toLowerCase() === `key${key}`;
	return keyName(event.key) === key;
}

/** A key's name in a binding: its lowercased `KeyboardEvent.key`, with the space bar named. */
const keyName = (key: string) => (key === " " ? "space" : key.toLowerCase());

const MODIFIERS = new Set(["control", "shift", "alt", "meta", "altgraph", "os"]);

/**
 * A key press as a binding ("mod+shift+k"), for recording a shortcut; undefined while only modifiers are down.
 * Physical-key names (CODE_KEYS) come from `code`, so what is recorded is what matchesBinding compares.
 */
export function comboFromEvent(event: KeyLike, mac: boolean): string | undefined {
	if (MODIFIERS.has(event.key.toLowerCase())) return undefined;
	const code = event.code?.toLowerCase() ?? "";
	const parts = [
		(mac ? event.metaKey : event.ctrlKey) ? "mod" : undefined,
		mac && event.ctrlKey ? "ctrl" : undefined,
		!mac && event.metaKey ? "meta" : undefined,
		event.altKey ? "alt" : undefined,
		event.shiftKey ? "shift" : undefined,
		CODE_KEYS.has(code) ? code : event.altKey && /^key[a-z]$/.test(code) ? code.slice(3) : keyName(event.key),
	];
	return parts.filter(Boolean).join("+");
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
