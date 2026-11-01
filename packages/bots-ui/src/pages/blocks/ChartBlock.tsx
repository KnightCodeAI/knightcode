// A chart from its declarative spec, drawn by the client.
import type { PageBlock } from "@knightcode/bots-protocol";
import { Chart } from "../../chat/rich/Chart.tsx";

export function ChartBlock({ block }: { block: Extract<PageBlock, { type: "chart" }> }) {
	return <Chart spec={block.spec} />;
}
