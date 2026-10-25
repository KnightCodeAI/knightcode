import {
	type Component,
	Container,
	Gutter,
	Spacer,
	Text,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@knightcode/tui";
import type {
	BackgroundShellMessageDetails,
	BackgroundShellNotice,
	BackgroundShellStatus,
} from "../../../core/background-shells.ts";
import type { MessageRenderer } from "../../../core/extensions/types.ts";
import { formatToolCall } from "../../../core/tools/render-utils.ts";
import { BLOCK_INDENT, BULLET_GUTTER, RESULT_GUTTER, RESULT_INDENT } from "../glyphs.ts";
import { type Theme, type ThemeColor, theme } from "../theme/theme.ts";
import { paddedMouseEvent, prefixOutputPad } from "./call-block.ts";
import { expandHint, VisualLinePreview } from "./visual-truncate.ts";

const PREVIEW_LINES = 5;

const BULLET_COLORS: Record<BackgroundShellStatus, ThemeColor> = {
	running: "dim",
	completed: "success",
	failed: "error",
	timed_out: "error",
	stopped: "muted",
};

function statusLabel(notice: BackgroundShellNotice): string {
	switch (notice.status) {
		case "completed":
			return "Completed";
		case "failed":
			if (notice.exitCode !== undefined) return `Failed with exit code ${notice.exitCode}`;
			return notice.error ? `Failed: ${notice.error}` : "Failed";
		case "timed_out":
			return "Timed out";
		case "stopped":
			switch (notice.stoppedBy) {
				case "user":
					return "Stopped by the user";
				case "model":
					return "Stopped by the agent";
				case "session":
					return "Stopped because the session ended";
				case "output_limit":
					return "Stopped: too much output";
				default:
					return "Stopped";
			}
		case "running":
			return "Running";
	}
}

/** `Background(npm test)` on one line: a long command is cut so the header never wraps. */
class NoticeHeader implements Component {
	private readonly command: string;
	private readonly t: Theme;

	constructor(command: string, t: Theme) {
		this.command = command.replace(/\s+/g, " ").trim();
		this.t = t;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.t;
		const budget = Math.max(0, width - visibleWidth("Background") - 2);
		const command = truncateToWidth(t.fg("toolOutput", this.command), budget, t.fg("toolOutput", "…"));
		return [truncateToWidth(formatToolCall(t, "Background", command), width, "…")];
	}
}

/** One ended command: `● Background(npm test)`, then its status and the end of its output. */
function noticeBlock(notice: BackgroundShellNotice, expanded: boolean, t: Theme): Component {
	const result = new Container();
	result.addChild(new Text(`${t.fg("toolOutput", statusLabel(notice))} ${t.fg("muted", `· ID ${notice.id}`)}`, 0, 0));
	if (notice.outputTail) {
		const output = notice.outputTail
			.split("\n")
			.map((outputLine) => t.fg("toolOutput", outputLine))
			.join("\n");
		result.addChild(
			expanded
				? new Text(output, 0, 0)
				: new VisualLinePreview({
						text: output,
						maxVisualLines: PREVIEW_LINES,
						keep: "end",
						formatHint: (hidden, compact) => expandHint(t, hidden, "earlier lines", compact),
					}),
		);
	}
	const block = new Container();
	block.addChild(
		new Gutter(new NoticeHeader(notice.command, t), t.fg(BULLET_COLORS[notice.status], BULLET_GUTTER), BLOCK_INDENT),
	);
	block.addChild(new Gutter(result, t.fg("dim", RESULT_GUTTER), RESULT_INDENT));
	return block;
}

class BackgroundShellMessageComponent extends Container {
	private readonly outputPad: number;

	constructor(notices: readonly BackgroundShellNotice[], expanded: boolean, outputPad: number, t: Theme) {
		super();
		this.outputPad = outputPad;
		notices.forEach((notice, index) => {
			if (index > 0) this.addChild(new Spacer(1));
			this.addChild(noticeBlock(notice, expanded, t));
		});
	}

	override render(width: number): string[] {
		const pad = Math.max(0, this.outputPad);
		return prefixOutputPad(super.render(Math.max(1, width - pad)), pad, width);
	}

	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		const next = paddedMouseEvent(event, this.outputPad);
		return next ? super.handleMouse(next) : undefined;
	}
}

/** Renders the message that tells the model background commands ended. */
export const renderBackgroundShellMessage: MessageRenderer = (message, options, t = theme) => {
	const notices = (message.details as BackgroundShellMessageDetails | undefined)?.notices;
	if (!notices?.length) return undefined;
	return new BackgroundShellMessageComponent(notices, options.expanded, options.outputPad, t);
};
