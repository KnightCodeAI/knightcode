/** Public reads and admitted actions on explicit workspace identities. */
import type {
	experimental_Checkout,
	experimental_GitRead,
	experimental_Handoff,
	experimental_HandoffCheck,
	experimental_Operation,
	experimental_WorkspaceServices,
} from "@knightcodeai/cli/desktop";
import { createElement, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { client, RequestError } from "../client.ts";
import { basename, samePath } from "../format.ts";
import { getState, openThread, refreshDiff, toast, useStore } from "../store.ts";
import { handoffPreflight, handoffProblem } from "./handoff-preflight.ts";

const checking = { status: "checking" } as const;
const operations = new Map<string, readonly experimental_Operation[]>();
const empty: readonly experimental_Operation[] = [];
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
const update = (id: string, list: readonly experimental_Operation[]) => {
	const previous = operations.get(id) ?? empty;
	operations.set(id, list);
	if (
		list.some(
			(operation) =>
				operation.completed.length > (previous.find((old) => old.id === operation.id)?.completed.length ?? 0),
		)
	)
		refreshDiff(id);
	version++;
	for (const listener of listeners) listener();
};
const rememberUnknown = (id: string, operation: experimental_Operation) =>
	update(id, [
		...(operations.get(id) ?? empty).filter((op) => op.status !== "running" && op.id !== operation.id),
		operation,
	]);
const problemOf = (error: unknown) => {
	const response = error instanceof RequestError ? error : undefined;
	const data = response?.data as { paths?: string[]; recoveryInstructions?: string[] } | undefined;
	return {
		code: response?.code ?? "internal",
		message: error instanceof Error ? error.message : String(error),
		paths: data?.paths,
		recoveryInstructions: data?.recoveryInstructions,
	};
};
const matches = (target: experimental_Checkout, thread: { cwd: string; projectCwd: string }) =>
	samePath(target.cwd, thread.cwd) && samePath(target.projectCwd, thread.projectCwd);

export function startWorkspaceOperations(signal: AbortSignal): void {
	const dispose = client.onNotification((event) => {
		if (event.method === "desktopOperation/changed") update(event.params.threadId, event.params.operations);
	});
	signal.addEventListener("abort", dispose, { once: true });
}

/** Unknown writes remain visible even when their originating provider has gone away. */
export function OperationRecovery() {
	useSyncExternalStore(subscribe, () => version);
	const operation = [...operations.values()].flat().find((op) => op.status === "outcome-unknown");
	if (!operation) return null;
	return createElement(
		"aside",
		{
			role: "alert",
			"aria-label": "Workspace recovery",
			className:
				"fixed top-12 right-4 z-[120] max-w-md rounded-xl border border-line bg-surface p-3 text-sm text-ink shadow-lg",
		},
		createElement(
			"p",
			null,
			"The last Git or workspace action may have completed. Check the checkout and remote before continuing.",
		),
		createElement("p", { className: "mt-1 break-all text-xs text-secondary" }, operation.target.cwd),
		createElement("p", { className: "mt-1 text-xs" }, Object.values(operation.outputs).flat().join(" · ")),
		createElement(
			"button",
			{
				type: "button",
				className: "mt-2 rounded-md bg-soft px-2 py-1 hover:bg-ghost-hover",
				onClick: () => {
					void client
						.request("desktopOperation/recover", { target: operation.target, id: operation.id, action: "acknowledge" })
						.then(({ accepted }) => {
							if (accepted)
								update(
									operation.target.threadId,
									(operations.get(operation.target.threadId) ?? empty).filter((old) => old.id !== operation.id),
								);
						})
						.catch((error: unknown) => toast(problemOf(error).message, "error"));
				},
			},
			"I checked the outcome",
		),
	);
}

export function workspaceServices(
	signal: AbortSignal,
	admitted = () => !signal.aborted,
): experimental_WorkspaceServices {
	return {
		experimental_git(target) {
			const { threadId } = target;
			const current = () => {
				const state = getState();
				const thread = state.held[threadId]?.thread ?? state.threads.find((item) => item.id === threadId);
				return admitted() && thread && matches(target, thread);
			};
			return {
				async experimental_run(action) {
					if (!current()) return;
					const list = operations.get(threadId) ?? empty;
					const old = list.find((op) => op.status === "outcome-unknown") ?? list.find((op) => op.kind === action.kind);
					if (old?.status === "outcome-unknown") return old;
					try {
						const { operation } = await client.request("desktopOperation/start", { target, action });
						if (operation.status === "outcome-unknown") rememberUnknown(threadId, operation);
						if (operation.kind === action.kind && operation.status !== "running") {
							const { outputs } = operation;
							if (operation.status === "completed" && action.kind === "restore") await openThread(threadId);
							if (operation.id !== old?.id) {
								if (action.kind !== "pullRequest" && outputs.commit)
									toast(`Committed ${outputs.commit.slice(0, 7)}: ${outputs.message?.split("\n")[0]}`, "success");
								if (action.kind !== "pullRequest" && outputs.remote)
									toast(`Pushed ${outputs.branch} to ${outputs.remote}`, "success");
								if (outputs.url) toast(`Created ${outputs.url}`, "success");
								for (const warning of outputs.warnings ?? []) toast(warning);
								if (action.kind === "handoff" && outputs.branch)
									toast(
										`Checked out ${outputs.branch} in ${basename(action.to === "local" ? target.projectCwd : target.cwd)}`,
										"success",
									);
							}
						}
						return admitted() ? operation : undefined;
					} catch (error) {
						const problem = problemOf(error);
						// Native transport carries its retained journal entry, including confirmed outputs.
						const lost =
							error instanceof RequestError
								? (error.data as { operation?: experimental_Operation } | undefined)?.operation
								: undefined;
						const operation: experimental_Operation = lost ?? {
							id: crypto.randomUUID(),
							target,
							kind: action.kind,
							status: "refused",
							recovery: "none",
							problem,
							outputs: {},
							completed: [],
						};
						if (lost) rememberUnknown(threadId, lost);
						return admitted() ? operation : undefined;
					}
				},
				async experimental_recover(id, action) {
					if (!admitted()) return;
					const list = operations.get(threadId) ?? empty;
					const old = list.find((op) => op.id === id);
					try {
						const { operation, accepted } = await client.request("desktopOperation/recover", { target, id, action });
						if (accepted && action === "retry" && operation?.status === "completed") {
							const { remote, branch, url } = operation.outputs;
							if (operation.kind !== "pullRequest" && remote && !old?.outputs.remote)
								toast(`Pushed ${branch} to ${remote}`, "success");
							if (url) toast(`Created ${url}`, "success");
						}
						return admitted() ? operation : undefined;
					} catch (error) {
						const lost =
							error instanceof RequestError
								? (error.data as { operation?: experimental_Operation } | undefined)?.operation
								: undefined;
						if (lost) {
							rememberUnknown(threadId, lost);
							return admitted() ? lost : undefined;
						}
						return undefined;
					}
				},
				async experimental_openPullRequest(id) {
					if (!current()) return false;
					const operation = operations.get(threadId)?.find((op) => op.id === id);
					if (operation?.id !== id || !operation.outputs.url || !matches(target, operation.target)) return false;
					await client.host("host/shell/openExternal", { url: operation.outputs.url });
					return admitted();
				},
			};
		},
		experimental_useGit(target, reads = { status: true, totals: true, branches: true }) {
			const { threadId, cwd, projectCwd } = target;
			const { status, totals, branches } = reads;
			const server = useStore((s) => s.server.state);
			const version = useStore((s) => (reads.once ? undefined : (s.diffVersion[threadId] ?? 0)));
			const op = useSyncExternalStore(subscribe, () => operations.get(threadId) ?? empty);
			const key = JSON.stringify([threadId, cwd, projectCwd]);
			const [data, setData] = useState<{ key: string; values: Partial<experimental_GitRead> }>();
			useEffect(() => {
				const before = operations.get(threadId);
				let mounted = true;
				void client
					.request("desktopOperation/read", { threadId })
					.then(({ operations: listed }) => {
						if (mounted && operations.get(threadId) === before) update(threadId, listed);
					})
					.catch(() => {});
				return () => {
					mounted = false;
				};
			}, [key, threadId, server]);
			useEffect(() => {
				let mounted = true;
				const apply = (read: Partial<experimental_GitRead>) => {
					if (
						mounted &&
						admitted() &&
						(() => {
							const thread = getState().held[threadId]?.thread;
							return !!thread && matches(target, thread);
						})()
					)
						setData((previous) => ({ key, values: { ...(previous?.key === key ? previous.values : {}), ...read } }));
				};
				if (status)
					void client
						.request("git/status", { threadId })
						.then((value) => apply({ status: value }))
						.catch(() => apply({ status: undefined }));
				if (branches)
					void client
						.request("git/branches", { threadId })
						.then((value) => apply({ branches: value }))
						.catch(() => apply({ branches: undefined }));
				if (totals)
					void client
						.request("thread/diff/read", { threadId, scope: "uncommitted", context: 0 })
						.then(({ files }) =>
							apply({
								totals: files.reduce(
									(sum, file) => ({
										additions: sum.additions + file.additions,
										deletions: sum.deletions + file.deletions,
									}),
									{ additions: 0, deletions: 0 },
								),
							}),
						)
						.catch(() => apply({ totals: undefined }));
				return () => {
					mounted = false;
				};
			}, [key, threadId, version, status, totals, branches, server]);
			const matching = op.filter((entry) => matches(target, entry.target));
			return {
				...(data?.key === key ? data.values : {}),
				operations: matching,
				operation: matching.find((op) => op.status === "running" || op.status === "outcome-unknown") ?? matching.at(-1),
			};
		},
		experimental_useBranchSuggestion(title) {
			const [prefix, setPrefix] = useState("kc/");
			useEffect(() => {
				let mounted = true;
				void client
					.request("config/read", {})
					.then(({ settings }) => {
						const worktrees = (settings as { worktrees?: { branchPrefix?: unknown } }).worktrees;
						if (mounted && typeof worktrees?.branchPrefix === "string") setPrefix(worktrees.branchPrefix);
					})
					.catch(() => {});
				return () => {
					mounted = false;
				};
			}, []);
			return (
				prefix +
				(title
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "")
					.slice(0, 40)
					.replace(/-+$/, "") || "handoff")
			);
		},
		experimental_useHandoffCheck(target: experimental_Checkout, action: experimental_Handoff) {
			const { threadId, cwd, projectCwd } = target;
			const { to, branch, environment } = action;
			type Result = { owner: object; branch: string; verdict: experimental_HandoffCheck };
			const [result, setResult] = useState<Result>();
			const checker = useMemo(() => {
				const checker = handoffPreflight(
					async (next) => {
						if (!admitted()) return checking;
						try {
							const response = await client.request("desktopOperation/preflight", {
								target: { threadId, cwd, projectCwd },
								to,
								environment,
								branch: next || undefined,
							});
							return admitted() ? { status: "ready", ...response } : checking;
						} catch (error) {
							return admitted() ? handoffProblem(problemOf(error)) : checking;
						}
					},
					(branch, verdict) => setResult({ owner: checker, branch, verdict }),
				);
				return checker;
			}, [threadId, cwd, projectCwd, to, environment]);
			useEffect(() => {
				const focus = () => checker.refresh();
				window.addEventListener("focus", focus);
				signal.addEventListener("abort", checker.stop, { once: true });
				return () => {
					window.removeEventListener("focus", focus);
					signal.removeEventListener("abort", checker.stop);
					checker.stop();
				};
			}, [checker]);
			useEffect(() => checker.set(branch ?? ""), [checker, branch]);
			return result?.owner === checker && result.branch === (branch ?? "") ? result.verdict : checking;
		},
		experimental_useWorkspaceOptions(cwd) {
			const [data, setData] = useState<{
				cwd: string;
				options: ReturnType<experimental_WorkspaceServices["experimental_useWorkspaceOptions"]>;
			}>();
			useEffect(() => {
				if (!cwd) return;
				let mounted = true;
				const apply = (options: NonNullable<typeof data>["options"]) => {
					if (mounted) setData((old) => ({ cwd, options: { ...(old?.cwd === cwd ? old.options : {}), ...options } }));
				};
				void client
					.request("git/branches", { cwd })
					.then((branches) => apply({ branches }))
					.catch(() => {});
				void client
					.request("environment/list", { cwd })
					.then(({ environments }) => apply({ environments }))
					.catch(() => {});
				return () => {
					mounted = false;
				};
			}, [cwd]);
			return data && data.cwd === cwd ? data.options : {};
		},
	};
}
