import type { MarkdownTheme } from "@knightcode/tui";
import type { CompactionSummaryMessage } from "../../../core/messages.ts";
import { CollapsibleCallComponent, countedSummary } from "./call-block.ts";

/** A compaction, drawn like a tool call: `● Compact(N tokens)`, `⎿  Summarized · N lines`, then the summary. */
export class CompactionSummaryMessageComponent extends CollapsibleCallComponent {
	constructor(message: CompactionSummaryMessage, markdownTheme?: MarkdownTheme, outputPad = 1) {
		super(
			"Compact",
			`${message.tokensBefore.toLocaleString()} tokens`,
			countedSummary("Summarized", message.summary),
			message.summary,
			markdownTheme,
			outputPad,
		);
	}
}
