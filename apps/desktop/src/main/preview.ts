/**
 * Preview guests (desktop-shell.md sections 6.3 and 9.8): the `<webview>` a window's preview tab holds. Main decides
 * what attaches (only a thread's preview partition, only an http, https or blank page, never with a preload, Node or
 * web security off),
 * what a guest may do (no permissions; downloads through a save dialog; links that open windows load in place;
 * navigations and redirects only to http and https), and which keys a focused guest hands to the app.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { session, type WebContents } from "electron";
import { DESKTOP_KEYBINDINGS, type KeybindingId, matchesBinding } from "../shared/keybindings.ts";
import { isPreviewUrl, PREVIEW_PARTITION, previewPartition } from "../shared/preview-url.ts";

/** App bindings that work while a page in a preview has focus: the preview's own, and the window-level ones. */
const OVER_PREVIEW = (Object.keys(DESKTOP_KEYBINDINGS) as KeybindingId[]).filter(
	(id) =>
		id.startsWith("desktop.preview.") ||
		[
			"desktop.palette",
			"desktop.sidebar.toggle",
			"desktop.panel.toggle",
			"desktop.terminal.toggle",
			"desktop.terminal.new",
			"desktop.thread.new",
		].includes(id),
);

/** The user's rebindings, which the renderer sends whenever they change (host/keys/set): main hardcodes no key. */
let overrides: Partial<Record<KeybindingId, string[]>> = {};
export function setKeyOverrides(next: Record<string, string[]>): void {
	overrides = next as typeof overrides;
}

const configured = new Set<string>();

/** Each preview partition's session, set up once: no permissions, and downloads only where the user saves them. */
function configureSession(partition: string): void {
	if (configured.has(partition)) return;
	configured.add(partition);
	const preview = session.fromPartition(partition);
	preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
	preview.setPermissionCheckHandler(() => false);
	// With no save path set Electron asks where with its own save dialog, which does not block main (a synchronous one
	// would stall every window's traffic while open), and cancels the download when it is dismissed.
	preview.on("will-download", (_event, item) => {
		item.setSaveDialogOptions({ defaultPath: item.getFilename() });
	});
}

/**
 * Guard a window's webviews. `onKey` runs an app binding a focused guest's key press matched, in the window that hosts
 * the guest, as if it had been pressed there.
 */
export function guardWebviews(contents: WebContents, onKey: (binding: KeybindingId) => void): void {
	contents.on("will-attach-webview", (event, preferences, params) => {
		delete preferences.preload;
		preferences.nodeIntegration = false;
		preferences.nodeIntegrationInSubFrames = false;
		preferences.contextIsolation = true;
		preferences.sandbox = true;
		preferences.webSecurity = true;
		preferences.allowRunningInsecureContent = false;
		if (!PREVIEW_PARTITION.test(params.partition ?? "") || !isPreviewUrl(params.src ?? "about:blank")) {
			event.preventDefault();
			return;
		}
		configureSession(params.partition);
	});
	contents.on("did-attach-webview", (_event, guest) => {
		guest.setWindowOpenHandler(({ url }) => {
			// After the handler returns: a load started inside it is cancelled with the refused window.
			if (url !== "about:blank" && isPreviewUrl(url)) setTimeout(() => void guest.loadURL(url).catch(() => {}));
			return { action: "deny" };
		});
		const stay = (event: Electron.Event, url: string) => {
			if (!isPreviewUrl(url)) event.preventDefault();
		};
		guest.on("will-navigate", stay);
		guest.on("will-redirect", stay);
		const mac = process.platform === "darwin";
		guest.on("before-input-event", (event, input) => {
			if (input.type !== "keyDown") return;
			const key = {
				key: input.key,
				code: input.code,
				ctrlKey: input.control,
				metaKey: input.meta,
				shiftKey: input.shift,
				altKey: input.alt,
			};
			const binding = OVER_PREVIEW.find((id) => matchesBinding(key, id, mac, overrides));
			if (!binding) return;
			event.preventDefault();
			onKey(binding);
		});
	});
}

/** A deleted thread's preview storage (cookies, local storage, cache) goes with it; a partition never used stays absent. */
export async function clearPreview(userData: string, threadId: string): Promise<void> {
	const partition = previewPartition(threadId);
	if (!existsSync(join(userData, "Partitions", encodeURIComponent(partition.slice("persist:".length))))) return;
	await session.fromPartition(partition).clearStorageData();
	await session.fromPartition(partition).clearCache();
}
