// Runs with their status, time and result; a running one can be stopped. Used per routine and in Activity.
import type { Run } from "@knightcode/bots-protocol";
import { formatDay, formatTime } from "../chat/layout.ts";
import { useStore } from "../state/store.ts";

const STATUS: Record<Run["status"], string> = {
	queued: "Queued",
	running: "Running",
	succeeded: "Done",
	failed: "Failed",
	stopped: "Stopped",
};

/** "4m 10s" between start and end, or since start while running. */
export function runDuration(run: Pick<Run, "startedAt" | "endedAt">, now = Date.now()): string {
	const seconds = Math.max(0, Math.round(((run.endedAt ?? now) - run.startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The list; `label` names each run's bot when runs span bots. */
export function RunHistory({
	runs,
	label,
	onChange,
}: {
	runs: Run[];
	label?: (run: Run) => string;
	onChange: () => void;
}) {
	const store = useStore();
	if (runs.length === 0) return <p className="kb-settings__hint">No runs yet.</p>;
	return (
		<ul className="kb-runs" aria-label="Runs">
			{runs.map((run) => (
				<li key={run.id} className="kb-runs__item" data-status={run.status}>
					<span className="kb-runs__dot" aria-hidden />
					<div className="kb-runs__main">
						<span className="kb-runs__title">
							{label ? `${label(run)} · ` : ""}
							{run.title}
							{run.late && <span className="kb-runs__late"> · late</span>}
						</span>
						<span className="kb-runs__meta">
							{STATUS[run.status]} · {formatDay(run.startedAt)} {formatTime(run.startedAt)} · {runDuration(run)}
						</span>
						{run.summary && <span className="kb-runs__summary">{run.summary}</span>}
					</div>
					{run.status === "running" && (
						<button
							type="button"
							className="kb-pill"
							onClick={() => void store.api.stopRun({ id: run.id }).then(onChange)}
						>
							Stop
						</button>
					)}
				</li>
			))}
		</ul>
	);
}
