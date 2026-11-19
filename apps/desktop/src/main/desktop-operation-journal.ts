/** Keep ambiguous Git writes in main across renderer reload and app-server restart; never replay them. */
import type { ParamsOf, ResultOf } from "@knightcode/app-server-protocol";

type Operation = ResultOf<"desktopOperation/start">["operation"];
type Target = ParamsOf<"desktopOperation/start">["target"];
type Action = ParamsOf<"desktopOperation/start">["action"];
const pathKey = (path: string) => {
	const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};
const sameTarget = (a: Target, b: Target) =>
	a.threadId === b.threadId && pathKey(a.cwd) === pathKey(b.cwd) && pathKey(a.projectCwd) === pathKey(b.projectCwd);

export class DesktopOperationJournal {
	private readonly latest = new Map<string, Operation[]>();
	private readonly uncertain = new Map<string, Operation>();
	private readonly pending = new Map<string, { target: Target; action?: Action }>();

	/** Renderer params are wire input; the app server remains the authority for admitting each action. */
	intercept(
		method: string,
		params: Record<string, unknown>,
	): { operation?: Operation; accepted?: boolean } | undefined {
		if (method !== "desktopOperation/start" && method !== "desktopOperation/recover") return;
		const target = params.target as Target | undefined;
		if (!target) return;
		const operation = this.unknownAt(target);
		if (!operation) return;
		if (method === "desktopOperation/start") return { operation };
		if (operation.id !== params.id) return { operation, accepted: false };
		if (params.action !== "acknowledge") return { operation, accepted: false };
		this.uncertain.delete(operation.id);
		return { accepted: true };
	}

	track(id: string, method: string, params: Record<string, unknown>): void {
		if (method === "desktopOperation/start") {
			const { target, action } = params as ParamsOf<"desktopOperation/start">;
			this.pending.set(id, { target, action });
		} else if (method === "desktopOperation/recover" && params.action === "retry") {
			this.pending.set(id, { target: params.target as Target });
		}
	}

	answered(id: string): void {
		this.pending.delete(id);
	}

	observe(threadId: string, operations: Operation[]): void {
		this.latest.set(threadId, operations);
	}

	uncertainThreads(): string[] {
		return [...new Set([...this.uncertain.values()].map((operation) => operation.target.threadId))];
	}

	read(threadId: string, operations: Operation[]): Operation[] {
		return [...operations, ...[...this.uncertain.values()].filter((op) => op.target.threadId === threadId)];
	}

	/** The retained unknown write on this checkout, with the same path identity as admission uses. */
	unknownAt(target: Target): Operation | undefined {
		return [...this.uncertain.values()].find((operation) => sameTarget(operation.target, target));
	}

	lost(): void {
		const mark = (operation: Operation) => {
			this.uncertain.set(operation.id, {
				...operation,
				status: "outcome-unknown",
				recovery: "reconcile",
				problem: {
					code: "serverRestarted",
					message:
						"The app server restarted before confirming the write. Check the checkout and remote before continuing.",
				},
			});
		};
		for (const list of this.latest.values())
			for (const operation of list)
				if (operation.status === "running" || operation.status === "outcome-unknown") mark(operation);
		for (const [id, { target, action }] of this.pending) {
			if ([...this.uncertain.values()].some((op) => sameTarget(op.target, target))) continue;
			const latest = this.latest.get(target.threadId)?.at(-1);
			if (latest && sameTarget(latest.target, target)) {
				mark(latest);
				continue;
			}
			if (action)
				mark({
					id: `unknown:${id}`,
					target,
					kind: action.kind,
					status: "outcome-unknown",
					recovery: "reconcile",
					outputs: {},
					completed: [],
				});
		}
		this.pending.clear();
		this.latest.clear();
	}
}
