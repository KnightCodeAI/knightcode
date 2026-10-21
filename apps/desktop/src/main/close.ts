/**
 * Codex's "Confirm before closing a window" (Settings › General, desktop state): the close shortcut asks unless the
 * preference is "never"; the close button and Alt+F4 ask only with "always". A confirmed window closes without asking
 * again.
 */

import { type BrowserWindow, dialog } from "electron";
import type { StateFile } from "./state.ts";

const confirmed = new WeakSet<BrowserWindow>();
// A second close while the question shows would stack another dialog.
const asking = new WeakSet<BrowserWindow>();
// Quit already asked its own question (main.ts before-quit); its window closes must not cancel it.
let quitting = false;

export function markQuitting(): void {
	quitting = true;
}

const setting = (state: StateFile) => state.read().preferences?.confirmClose ?? "shortcut";

async function askToClose(window: BrowserWindow): Promise<void> {
	if (asking.has(window)) return;
	asking.add(window);
	const { response } = await dialog
		.showMessageBox(window, {
			type: "question",
			title: "Close window?",
			message: "Close this KnightCode window?",
			buttons: ["Close", "Cancel"],
			defaultId: 0,
			cancelId: 1,
			noLink: true,
		})
		.finally(() => asking.delete(window));
	// A quit can destroy the window while the question shows.
	if (response !== 0 || window.isDestroyed()) return;
	confirmed.add(window);
	window.close();
}

/** The close shortcut (desktop.window.close). */
export function closeFromShortcut(window: BrowserWindow, state: StateFile): void {
	if (setting(state) === "never") window.close();
	else void askToClose(window);
}

/** The window's `close` event: the close button, Alt+F4, the system menu. */
export function onWindowClose(window: BrowserWindow, state: StateFile, event: { preventDefault(): void }): void {
	if (quitting || confirmed.has(window) || setting(state) !== "always") return;
	event.preventDefault();
	void askToClose(window);
}
