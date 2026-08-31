import type { Component } from "@knightcode/tui";
import { truncateToWidth } from "@knightcode/tui";
import { theme } from "../theme/theme.ts";
import { keyHint, keyText, rawKeyHint } from "./keybinding-hints.ts";

/**
 * The one-line shortcut reminder under the input box.
 *
 * Built fresh on every render so a keybinding reload is picked up, and hidden
 * while a suggestion menu is open so it does not crowd the list.
 */
export class HintLineComponent implements Component {
	private isHidden: () => boolean;

	constructor(isHidden: () => boolean = () => false) {
		this.isHidden = isHidden;
	}

	invalidate(): void {
		// Nothing cached: the text is rebuilt on every render.
	}

	render(width: number): string[] {
		if (this.isHidden() || width < 8) {
			return [];
		}

		const clear = keyText("app.clear");
		const exit = keyText("app.exit");
		const hints = [
			rawKeyHint("/", "commands"),
			rawKeyHint("!", "bash"),
			keyHint("app.tools.expand", "expand"),
			clear && exit ? rawKeyHint(`${clear}/${exit}`, "clear/exit") : keyHint("app.interrupt", "interrupt"),
		].filter(Boolean);

		const line = `  ${hints.join(theme.fg("dim", " · "))}`;
		return [truncateToWidth(line, width, theme.fg("dim", "..."))];
	}
}
