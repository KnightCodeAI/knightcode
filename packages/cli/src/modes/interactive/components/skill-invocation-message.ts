import type { MarkdownTheme } from "@knightcode/tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import type { ParsedSkillBlock } from "../../../core/agent-session.ts";
import { CollapsibleCallComponent, countedSummary } from "./call-block.ts";

/**
 * A skill invocation, drawn like a tool call: `● Skill(name)` with `⎿  Loaded · N lines` under it, and the
 * skill's content under that when expanded. Only renders the skill block itself - the user message is
 * rendered separately.
 */
export class SkillInvocationMessageComponent extends CollapsibleCallComponent {
	constructor(
		skillBlock: ParsedSkillBlock,
		markdownTheme?: MarkdownTheme,
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		messageId?: string,
		timestamp?: string,
	) {
		super(
			"Skill",
			skillBlock.name,
			countedSummary("Loaded", skillBlock.content),
			skillBlock.content,
			markdownTheme,
			outputPad,
			markdownTransformers,
			messageId,
			timestamp,
			"custom",
		);
	}
}
