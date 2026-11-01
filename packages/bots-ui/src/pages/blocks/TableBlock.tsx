// A table of plain cells.
import type { PageBlock } from "@knightcode/bots-protocol";

type Cell = Extract<PageBlock, { type: "table" }>["rows"][number][number];

export function TableBlock({ block }: { block: Extract<PageBlock, { type: "table" }> }) {
	return (
		<div className="kb-page-table">
			<table>
				<thead>
					<tr>
						{block.columns.map((column, i) => (
							<th key={i} scope="col">
								{column}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{block.rows.map((row, i) => (
						<tr key={i}>
							{row.map((cell, j) => (
								<td key={j}>{cellText(cell)}</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** A cell as text; anything that is not a string or number is shown as JSON, never interpreted. */
export function cellText(cell: Cell): string {
	if (cell === null || cell === undefined) return "";
	if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") return String(cell);
	return JSON.stringify(cell);
}
