import { type Component, truncateToWidth, visibleWidth } from "@knightcode/tui";
import { APP_NAME } from "../../../config.ts";
import type { BackgroundUpdateState } from "../../../utils/background-update.ts";
import { theme } from "../theme/theme.ts";

/** A single right-aligned update line immediately above the prompt. */
export class BackgroundUpdateNotice implements Component {
	private readonly getState: () => BackgroundUpdateState | undefined;

	constructor(getState: () => BackgroundUpdateState | undefined) {
		this.getState = getState;
	}

	invalidate(): void {
		// State and theme colors are read afresh on every render.
	}

	render(width: number): string[] {
		const state = this.getState();
		if (!state || state.phase === "available") return [];
		if (width <= 0) return [""];

		const version = `v${state.release.version}`;
		const messages = {
			downloading: `Downloading ${version}`,
			verifying: `Verifying ${version}`,
			ready: `Restart for ${version}`,
			failed: `${version} failed · ${APP_NAME} update`,
			waiting: `${version} updating elsewhere`,
		};
		const color =
			state.phase === "ready"
				? "success"
				: state.phase === "failed"
					? "error"
					: state.phase === "waiting"
						? "warning"
						: "muted";
		const text = truncateToWidth(theme.fg(color, messages[state.phase]), width - 1, "");
		return [" ".repeat(width - visibleWidth(text) - 1) + text + " "];
	}
}
