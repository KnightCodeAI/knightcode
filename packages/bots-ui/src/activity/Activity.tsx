// Activity: every run across bots, newest first, filtered by status and date. A running one can be stopped.
import type { RunStatus } from "@knightcode/bots-protocol";
import { useState } from "react";
import { Chips } from "../connectors/Catalog.tsx";
import { Select } from "../primitives/Select.tsx";
import { RunHistory } from "../routines/RunHistory.tsx";
import { useBots, useResource, useStore } from "../state/store.ts";

const DAY = 86_400_000;
const RANGES = [
	{ value: "1", label: "Today" },
	{ value: "7", label: "Last 7 days" },
	{ value: "30", label: "Last 30 days" },
	{ value: "all", label: "All time" },
];

/** The Activity panel. */
export function Activity() {
	const store = useStore();
	const [status, setStatus] = useState<RunStatus | "all">("all");
	const [range, setRange] = useState("7");
	const from = range === "all" ? undefined : Date.now() - Number(range) * DAY;
	const key = `runs:all:${status}:${range}`;
	const { data } = useResource(key, (api) => api.listRuns({ status: status === "all" ? undefined : status, from }));
	const { data: bots } = useBots();
	const runs = [...(data?.runs ?? [])].sort((a, b) => b.startedAt - a.startedAt);
	return (
		<div className="kb-activity">
			<div className="kb-activity__filters">
				<Chips
					label="Run status"
					value={status}
					onChange={(next) => setStatus(next as RunStatus | "all")}
					items={[
						{ value: "all", label: "All" },
						{ value: "running", label: "Running" },
						{ value: "succeeded", label: "Done" },
						{ value: "failed", label: "Failed" },
						{ value: "stopped", label: "Stopped" },
					]}
				/>
				<Select label="Date range" value={range} options={RANGES} onValueChange={setRange} />
			</div>
			<RunHistory
				runs={runs}
				label={(run) => bots?.bots.find((b) => b.id === run.botId)?.name ?? "A bot"}
				onChange={() => store.reload(key)}
			/>
		</div>
	);
}
