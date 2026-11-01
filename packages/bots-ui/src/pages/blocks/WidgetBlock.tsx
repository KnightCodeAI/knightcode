// A live widget: data the bot's source refreshed (a routine's output, a connector read, a file), shown as a number,
// list, table or chart. Refreshes read data directly; no model runs.
import type { ChartSpec, PageBlock } from "@knightcode/bots-protocol";
import { Chart } from "../../chat/rich/Chart.tsx";
import { formatDay, formatTime } from "../../chat/layout.ts";
import { cellText } from "./TableBlock.tsx";

type Widget = Extract<PageBlock, { type: "widget" }>;

export function WidgetBlock({ block }: { block: Widget }) {
	return (
		<section className="kb-widget" aria-label={block.title}>
			<header className="kb-widget__head">
				<span className="kb-widget__title">{block.title}</span>
				{block.refreshedAt && (
					<span className="kb-widget__time">
						Updated {formatDay(block.refreshedAt)} {formatTime(block.refreshedAt)}
					</span>
				)}
			</header>
			<WidgetBody block={block} />
		</section>
	);
}

function WidgetBody({ block }: { block: Widget }) {
	const data = block.data as unknown;
	if (data === undefined || data === null) return <p className="kb-settings__hint">Waiting for the first refresh.</p>;
	switch (block.view) {
		case "number":
			return (
				<p className="kb-widget__number">
					{typeof data === "number" || typeof data === "string" ? String(data) : cellText(data as never)}
				</p>
			);
		case "list":
			return (
				<ul className="kb-widget__list">
					{(Array.isArray(data) ? data : [data]).map((item, i) => (
						<li key={i}>{cellText(item as never)}</li>
					))}
				</ul>
			);
		case "table": {
			const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
			const columns = [...new Set(rows.flatMap((row) => (row && typeof row === "object" ? Object.keys(row) : [])))];
			return (
				<div className="kb-page-table">
					<table>
						<thead>
							<tr>
								{columns.map((c) => (
									<th key={c} scope="col">
										{c}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, i) => (
								<tr key={i}>
									{columns.map((c) => (
										<td key={c}>{cellText(row[c] as never)}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}
		case "chart":
			return isChartSpec(data) ? (
				<Chart spec={data} />
			) : (
				<p className="kb-settings__hint">This data cannot be drawn as a chart.</p>
			);
	}
}

function isChartSpec(value: unknown): value is ChartSpec {
	const v = value as ChartSpec;
	return Boolean(
		v && Array.isArray(v.labels) && Array.isArray(v.series) && ["line", "bar", "area", "pie"].includes(v.kind),
	);
}
