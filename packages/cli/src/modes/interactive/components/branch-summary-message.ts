import type { MarkdownTheme } from "@knightcode/tui";
import type { BranchSummaryMessage } from "../../../core/messages.ts";
import { CollapsibleCallComponent, countedSummary } from "./call-block.ts";

/** A branch summary, drawn like a tool call: `● Branch(summary)`, `⎿  Summarized · N lines`, then the summary. */
export class BranchSummaryMessageComponent extends CollapsibleCallComponent {
	constructor(message: BranchSummaryMessage, markdownTheme?: MarkdownTheme, outputPad = 1) {
		super(
			"Branch",
			"summary",
			countedSummary("Summarized", message.summary),
			message.summary,
			markdownTheme,
			outputPad,
		);
	}
}
