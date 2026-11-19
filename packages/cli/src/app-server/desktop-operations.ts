/** Server-lifetime workflow records shared by desktop windows, independent of their mounts. */
import { randomUUID } from "node:crypto";
import type { ParamsOf, ResultOf } from "@knightcode/app-server-protocol";
import { AppServerError } from "./errors.ts";

type Target = ParamsOf<"desktopOperation/start">["target"];
type Action = ParamsOf<"desktopOperation/start">["action"];
type Snapshot = ResultOf<"desktopOperation/start">["operation"];
type Stage = Snapshot["completed"][number];
type Outputs = Snapshot["outputs"];

export interface DesktopOperationRun {
	readonly action: Action;
	readonly snapshot: Snapshot;
	step(stage: Stage, write: () => Promise<Outputs | undefined>): Promise<void>;
}

type Runner = (operation: DesktopOperationRun) => Promise<void>;
type Record = { snapshot: Snapshot; action: Action; cancelled: boolean };
const family = (kind: Action["kind"]) => (["commit", "commitAndPush", "push"].includes(kind) ? "commit" : kind);

export class DesktopOperations {
	private readonly records = new Map<string, Map<string, Record>>();
	private readonly active = new Map<string, Record>();
	private readonly changed: (threadId: string, snapshots: Snapshot[]) => void;

	constructor(changed: (threadId: string, snapshots: Snapshot[]) => void = () => {}) {
		this.changed = changed;
	}

	list(threadId: string): Snapshot[] {
		return [...(this.records.get(threadId)?.values() ?? [])].map((record) => record.snapshot);
	}

	read(threadId: string, kind?: Action["kind"]): Snapshot | undefined {
		return kind ? this.records.get(threadId)?.get(family(kind))?.snapshot : this.list(threadId).at(-1);
	}

	async start(target: Target, action: Action, run: Runner): Promise<Snapshot> {
		const thread = this.records.get(target.threadId) ?? new Map<string, Record>();
		const group = family(action.kind);
		const prior =
			this.list(target.threadId).find((op) => op.status === "running" || op.status === "outcome-unknown") ??
			this.read(target.threadId, action.kind);
		if (prior && ["running", "partial", "outcome-unknown"].includes(prior.status)) return prior;
		const snapshot: Snapshot = {
			id: randomUUID(),
			kind: action.kind,
			target,
			status: "running",
			recovery: "cancel",
			completed: [],
			outputs: {},
		};
		if (this.active.has(target.projectCwd)) {
			return {
				...snapshot,
				status: "refused",
				recovery: "none",
				problem: { code: "turnInProgress", message: "Another Git or workspace action is running in this project." },
			};
		}
		const record = { snapshot, action, cancelled: false };
		thread.delete(group);
		thread.set(group, record);
		this.records.set(target.threadId, thread);
		return this.run(record, run);
	}

	/** Runs the remaining steps only if the record asks for a retry and its project is free; `accepted` says whether it ran. */
	async retry(target: Target, id: string, run: Runner): Promise<{ accepted: boolean; operation?: Snapshot }> {
		const record = this.match(target, id);
		if (!record) return { accepted: false };
		if (record.snapshot.recovery !== "retry" || this.active.has(target.projectCwd))
			return { accepted: false, operation: record.snapshot };
		return { accepted: true, operation: await this.run(record, run) };
	}

	cancel(target: Target, id: string): boolean {
		const record = this.match(target, id);
		if (!record || record.snapshot.recovery !== "cancel") return false;
		record.cancelled = true;
		return true;
	}

	acknowledge(target: Target, id: string): boolean {
		const record = this.match(target, id);
		if (!record || !["partial", "outcome-unknown"].includes(record.snapshot.status)) return false;
		const thread = this.records.get(target.threadId)!;
		thread.delete(family(record.action.kind));
		if (!thread.size) this.records.delete(target.threadId);
		this.changed(target.threadId, this.list(target.threadId));
		return true;
	}

	private match(target: Target, id: string): Record | undefined {
		return [...(this.records.get(target.threadId)?.values() ?? [])].find(
			(record) =>
				record.snapshot.id === id &&
				record.snapshot.target.cwd === target.cwd &&
				record.snapshot.target.projectCwd === target.projectCwd,
		);
	}

	private async run(record: Record, runner: Runner): Promise<Snapshot> {
		const project = record.snapshot.target.projectCwd;
		this.active.set(project, record);
		const update = (changes: Partial<Snapshot>) => {
			record.snapshot = { ...record.snapshot, ...changes };
			this.changed(record.snapshot.target.threadId, this.list(record.snapshot.target.threadId));
		};
		update({
			status: "running",
			stage: undefined,
			problem: undefined,
			recovery: record.snapshot.completed.length ? "none" : "cancel",
		});
		let writing = false;
		try {
			await runner({
				action: record.action,
				get snapshot() {
					return record.snapshot;
				},
				async step(stage, write) {
					if (record.cancelled || record.snapshot.completed.includes(stage)) return;
					update({ stage, recovery: "none" });
					writing = true;
					const outputs = await write();
					writing = false;
					update({
						completed: [...record.snapshot.completed, stage],
						outputs: { ...record.snapshot.outputs, ...outputs },
					});
				},
			});
			update({ status: record.cancelled ? "cancelled" : "completed", recovery: "none", stage: undefined });
		} catch (error) {
			const response = error instanceof AppServerError ? error : undefined;
			const data = response?.data as
				| {
						paths?: string[];
						recoveryInstructions?: string[];
						outcomeUnknown?: boolean;
						handedOff?: boolean;
						savedIndex?: string;
						output?: string;
				  }
				| undefined;
			const unknown =
				writing &&
				(!response ||
					data?.outcomeUnknown === true ||
					data?.handedOff === true ||
					!!data?.savedIndex ||
					response.code === "shuttingDown" ||
					(response.code === "internal" && record.snapshot.stage !== "push" && !data?.output));
			const partial = record.snapshot.completed.length > 0;
			update({
				status: unknown ? "outcome-unknown" : partial ? "partial" : "refused",
				recovery: unknown ? "reconcile" : partial ? "retry" : "none",
				problem: {
					code: response?.code ?? "internal",
					message: error instanceof Error ? error.message : String(error),
					...(data?.paths ? { paths: data.paths } : {}),
					...(data?.recoveryInstructions ? { recoveryInstructions: data.recoveryInstructions } : {}),
				},
			});
		} finally {
			this.active.delete(project);
		}
		return record.snapshot;
	}
}
