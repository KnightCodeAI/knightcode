/** Keep only the newest branch check, including focus rechecks of the same branch. */
import type { experimental_HandoffCheck, experimental_Operation } from "@knightcodeai/cli/desktop";
import { latestCheck } from "../latest.ts";

export function handoffPreflight(
	read: (branch: string) => Promise<experimental_HandoffCheck>,
	publish: (branch: string, result: experimental_HandoffCheck) => void,
) {
	const check = latestCheck(250, read, publish);
	let current: string | undefined;
	return {
		set(branch: string) {
			if (branch === current) return;
			current = branch;
			publish(branch, { status: "checking" });
			check.set(branch);
		},
		refresh() {
			if (current === undefined) return;
			publish(current, { status: "checking" });
			check.refresh();
		},
		stop() {
			current = undefined;
			check.stop();
		},
	};
}

export function handoffProblem(problem: NonNullable<experimental_Operation["problem"]>): experimental_HandoffCheck {
	return {
		status: ["gitConflict", "invalidParams", "turnInProgress", "threadNotFound"].includes(problem.code)
			? "refused"
			: "transport-error",
		problem,
	};
}
