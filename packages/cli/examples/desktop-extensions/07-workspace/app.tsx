import {
	defineDesktopExtension,
	experimental_workspaceServices,
	type experimental_Checkout,
	type experimental_Handoff,
} from "@knightcodeai/cli/desktop";
import { useState } from "react";

function Workspace({ target }: { target: experimental_Checkout }) {
	const workspace = experimental_workspaceServices();
	const git = workspace.experimental_git(target);
	const { status, operation, branches } = workspace.experimental_useGit(target);
	const [message, setMessage] = useState("");
	const [pending, setPending] = useState(false);
	const suggested = workspace.experimental_useBranchSuggestion("workspace change");
	const action: experimental_Handoff = { kind: "handoff", to: target.cwd === target.projectCwd ? "worktree" : "local" };
	const check = workspace.experimental_useHandoffCheck(target, action);
	const blocked = pending || operation?.status === "running" || operation?.recovery === "reconcile";
	return (
		<section aria-label="Example workspace">
			<p>
				{status?.branch ?? "Detached or unavailable"} → {branches?.defaultBranch ?? "unknown base"}
			</p>
			<input aria-label="Example commit message" value={message} onChange={(event) => setMessage(event.target.value)} />
			<button
				disabled={blocked || operation?.recovery === "retry"}
				onClick={() => {
					setPending(true);
					void git
						.experimental_run({
							kind: "commitAndPush",
							includeUnstaged: true,
							message: message.trim() || undefined,
							branch: !status?.branch ? suggested : undefined,
						})
						.finally(() => setPending(false));
				}}
			>
				Example commit and push
			</button>
			<button
				disabled={blocked || check.status === "checking" || check.status === "refused"}
				onClick={() => void git.experimental_run(action)}
			>
				Move workspace
			</button>
			{operation && (
				<p role="status">
					{operation.status}: {operation.stage ?? operation.completed.join(", ")}
				</p>
			)}
			{operation?.problem && <p>{operation.problem.message}</p>}
			{operation?.recovery === "retry" && (
				<button onClick={() => void git.experimental_recover(operation.id, "retry")}>Retry remaining steps</button>
			)}
			{operation?.recovery === "cancel" && (
				<button onClick={() => void git.experimental_recover(operation.id, "cancel")}>Cancel before write</button>
			)}
		</section>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerPanelTab({
		id: "workspace",
		label: "Workspace example",
		experimental_available: ({ workspace }) => !!workspace,
		experimental_render: ({ context }) => (context.workspace ? <Workspace target={context.workspace} /> : null),
	});
});
