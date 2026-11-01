// Picks the renderer for a block. Every kind has one; none renders HTML or runs script from page data.
import type { PageBlock } from "@knightcode/bots-protocol";
import { ButtonBlock } from "./ButtonBlock.tsx";
import { ChartBlock } from "./ChartBlock.tsx";
import { FileBlock } from "./FileBlock.tsx";
import { ImageBlock } from "./ImageBlock.tsx";
import { TableBlock } from "./TableBlock.tsx";
import { TextBlock } from "./TextBlock.tsx";
import { WidgetBlock } from "./WidgetBlock.tsx";

export function BlockView({ block, pageId }: { block: PageBlock; pageId: string }) {
	switch (block.type) {
		case "text":
			return <TextBlock block={block} />;
		case "table":
			return <TableBlock block={block} />;
		case "chart":
			return <ChartBlock block={block} />;
		case "image":
			return <ImageBlock block={block} />;
		case "file":
			return <FileBlock block={block} />;
		case "widget":
			return <WidgetBlock block={block} />;
		case "button":
			return <ButtonBlock block={block} pageId={pageId} />;
	}
}
