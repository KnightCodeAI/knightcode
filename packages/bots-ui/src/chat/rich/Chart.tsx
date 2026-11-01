// A chart drawn from a declarative spec (bar, line, area or pie) as plain SVG: no code from the data ever runs.
import type { ChartSpec } from "@knightcode/bots-protocol";

const WIDTH = 520;
const HEIGHT = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 36 };
const SERIES_COLORS = [
	"var(--kb-avatar-blue)",
	"var(--kb-avatar-orange)",
	"var(--kb-avatar-green)",
	"var(--kb-avatar-magenta)",
	"var(--kb-avatar-violet)",
	"var(--kb-avatar-cyan)",
];

/** Renders `spec`; named "Chart: <title>" for assistive tech. */
export function Chart({ spec }: { spec: ChartSpec }) {
	const label = `Chart: ${spec.title ?? spec.series.map((s) => s.name).join(", ")}`;
	return (
		<figure className="kb-chart">
			{spec.title && <figcaption className="kb-chart__title">{spec.title}</figcaption>}
			<svg role="img" aria-label={label} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="kb-chart__svg">
				{spec.kind === "pie" ? <Pie spec={spec} /> : <Axes spec={spec} />}
			</svg>
			{spec.series.length > 1 && (
				<div className="kb-chart__legend">
					{spec.series.map((series, i) => (
						<span key={series.name} className="kb-chart__key">
							<span className="kb-chart__swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
							{series.name}
						</span>
					))}
				</div>
			)}
		</figure>
	);
}

function Axes({ spec }: { spec: ChartSpec }) {
	const values = spec.series.flatMap((s) => s.values);
	const max = niceMax(Math.max(0, ...values));
	const plotW = WIDTH - PAD.left - PAD.right;
	const plotH = HEIGHT - PAD.top - PAD.bottom;
	const step = plotW / Math.max(1, spec.labels.length);
	const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
	const ticks = [0, max / 2, max];
	return (
		<g>
			{ticks.map((t) => (
				<g key={t}>
					<line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} className="kb-chart__grid" />
					<text x={PAD.left - 6} y={y(t)} className="kb-chart__tick" textAnchor="end" dominantBaseline="middle">
						{formatTick(t)}
					</text>
				</g>
			))}
			{spec.labels.map((label, i) => (
				<text
					key={label + i}
					x={PAD.left + step * i + step / 2}
					y={HEIGHT - 8}
					className="kb-chart__tick"
					textAnchor="middle"
				>
					{label}
				</text>
			))}
			{spec.series.map((series, s) => {
				const color = SERIES_COLORS[s % SERIES_COLORS.length];
				if (spec.kind === "bar") {
					const barW = (step * 0.7) / spec.series.length;
					return series.values.map((v, i) => (
						<rect
							key={i}
							x={PAD.left + step * i + step * 0.15 + barW * s}
							y={y(v)}
							width={barW}
							height={Math.max(0, PAD.top + plotH - y(v))}
							rx={3}
							fill={color}
						/>
					));
				}
				const points = series.values.map((v, i) => `${PAD.left + step * i + step / 2},${y(v)}`);
				const area = `M${points[0]} L${points.join(" L")} L${PAD.left + step * (series.values.length - 1) + step / 2},${y(0)} L${PAD.left + step / 2},${y(0)} Z`;
				return (
					<g key={series.name}>
						{spec.kind === "area" && <path d={area} fill={color} opacity={0.18} />}
						<polyline
							points={points.join(" ")}
							fill="none"
							stroke={color}
							strokeWidth={2}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
					</g>
				);
			})}
		</g>
	);
}

function Pie({ spec }: { spec: ChartSpec }) {
	const values = spec.series[0]?.values ?? [];
	const total = values.reduce((a, b) => a + b, 0) || 1;
	const cx = WIDTH / 2;
	const cy = HEIGHT / 2;
	const r = HEIGHT / 2 - 12;
	let angle = -Math.PI / 2;
	return (
		<g>
			{values.map((v, i) => {
				const start = angle;
				angle += (v / total) * Math.PI * 2;
				const large = angle - start > Math.PI ? 1 : 0;
				const d = `M${cx},${cy} L${cx + r * Math.cos(start)},${cy + r * Math.sin(start)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)} Z`;
				return (
					<path key={i} d={d} fill={SERIES_COLORS[i % SERIES_COLORS.length]}>
						<title>{`${spec.labels[i] ?? i}: ${v}`}</title>
					</path>
				);
			})}
		</g>
	);
}

function niceMax(value: number): number {
	if (value <= 0) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	return Math.ceil(value / magnitude) * magnitude;
}

function formatTick(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Reads a chart spec from a ```chart code block; undefined when it is not one. */
export function parseChartSpec(source: string): ChartSpec | undefined {
	try {
		const value = JSON.parse(source) as Partial<ChartSpec>;
		const kinds = ["line", "bar", "area", "pie"];
		if (!kinds.includes(value.kind ?? "") || !Array.isArray(value.labels) || !Array.isArray(value.series))
			return undefined;
		if (
			!value.series.every(
				(s) => typeof s?.name === "string" && Array.isArray(s.values) && s.values.every((n) => typeof n === "number"),
			)
		)
			return undefined;
		return {
			kind: value.kind as ChartSpec["kind"],
			title: typeof value.title === "string" ? value.title : undefined,
			labels: value.labels.map(String),
			series: value.series,
		};
	} catch {
		return undefined;
	}
}
