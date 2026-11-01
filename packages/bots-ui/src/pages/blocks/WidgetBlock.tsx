// A live widget: data the bot's source refreshed (a routine's output, a connector read, a file), shown as a number,
// list, table or chart. Refreshes read data directly; no model runs.
import { type ChartSpec, ChartSpecSchema, type PageBlock, parse } from "@knightcode/bots-protocol";
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
			const rows = tableRows(data);
			const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
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

/** A widget's rows: the objects in its data, anything else left out (the data is whatever a source returned). */
export function tableRows(data: unknown): Record<string, unknown>[] {
	if (!Array.isArray(data)) return [];
	return data.filter(
		(row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row),
	);
}

/** Whether `value` is a chart the Chart component can draw, checked against the protocol's schema. */
export function isChartSpec(value: unknown): value is ChartSpec {
	try {
		parse(ChartSpecSchema, value);
		return true;
	} catch {
		return false;
	}
}
