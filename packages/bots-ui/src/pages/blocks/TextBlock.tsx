// Rich text, written as Markdown and rendered by our own components: raw HTML in it is shown as text, never parsed.
import type { PageBlock } from "@knightcode/bots-protocol";
import { Markdown } from "../../chat/rich/Markdown.tsx";

export function TextBlock({ block }: { block: Extract<PageBlock, { type: "text" }> }) {
	return <Markdown className="kb-prose kb-page-text" text={block.text} />;
}
