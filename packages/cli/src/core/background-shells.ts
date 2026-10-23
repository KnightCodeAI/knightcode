/**
 * Background shell commands: shell tool calls that keep running after the call returns.
 *
 * A command gets here when the model starts it with `run_in_background`, or when the user moves a
 * running foreground command here (Ctrl+B). The same process keeps running: it is never started
 * again. The session owns the commands. They outlive turns and aborted runs, and end when they
 * exit, when the model or the user stops them, or when the session is disposed.
 *
 * This module tracks processes and their output. Telling the model that a command ended is the
 * session's job (see `AgentSession`), so a process event never writes into a conversation itself.
 */

import { randomBytes } from "node:crypto";
import { stripAnsi } from "../utils/ansi.ts";
import { sanitizeBinaryOutput } from "../utils/shell.ts";
import type { OutputAccumulator } from "./tools/output-accumulator.ts";
import { formatSize, truncateTail } from "./tools/truncate.ts";

export type BackgroundShellStatus = "running" | "completed" | "failed" | "stopped" | "timed_out";

/** Who stopped a command: the model (`task_stop`), the user, the session ending, or the output limit. */
export type BackgroundShellStopper = "model" | "user" | "session" | "output_limit";

/** A snapshot of one background command, for the UI and the model. */
export interface BackgroundShellInfo {
	id: string;
	/** The shell tool that started it: `bash` or `powershell`. */
	toolName: string;
	/** The command as the model wrote it. */
	command: string;
	cwd: string;
	status: BackgroundShellStatus;
	startedAt: number;
	endedAt?: number;
	exitCode?: number;
	/** Why the command failed without an exit code. */
	error?: string;
	stoppedBy?: BackgroundShellStopper;
	/** The kill deadline the command was started with, in seconds. */
	timeoutSeconds?: number;
	/** The complete output, written as it arrives. */
	outputPath: string;
	/** Raw output bytes so far. */
	outputBytes: number;
	/** Set when writing the output file failed; the file is then incomplete. */
	outputFileError?: string;
}

/** A running shell process handed to the manager. */
export interface BackgroundShellExecution {
	toolName: string;
	command: string;
	cwd: string;
	timeoutSeconds?: number;
	/** Receives the process output. The manager persists it to a file and finishes it on exit. */
	output: OutputAccumulator;
	/** Settles when the process exits. Rejects with `aborted` or `timeout:<seconds>` like `BashOperations.exec`. */
	done: Promise<{ exitCode: number | null }>;
	/** Aborting it kills the process tree. */
	abort: AbortController;
}

export interface AdoptedBackgroundShell {
	id: string;
	outputPath: string;
	/** Route further output here: it counts toward the output limit. */
	append: (data: Buffer) => void;
}

export interface BackgroundShellManagerOptions {
	/** Called once per command when it ends, for whatever reason. */
	onSettled?: (shell: BackgroundShellInfo) => void;
	/** Stop a command whose output passes this many bytes. Default 1 GiB. */
	maxOutputBytes?: number;
}

// ponytail: fixed caps; make them settings if real workloads hit them.
/** Running commands per session. A model looping on starts is refused rather than forking without bound. */
export const MAX_RUNNING_BACKGROUND_SHELLS = 32;
/** Ended commands kept for `/tasks`; older ones are dropped. Their output files stay. */
const MAX_ENDED_BACKGROUND_SHELLS = 50;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;
/** Output kept in memory for an ended command, for `/tasks`. */
const ENDED_OUTPUT_TAIL_BYTES = 64 * 1024;

interface ShellRecord {
	info: BackgroundShellInfo;
	/** Live output; released when the command ends. */
	output: OutputAccumulator | undefined;
	/** The output tail kept once the command ended. */
	endedOutput: string;
	abort: AbortController;
	settled: Promise<void>;
	/** Set once the process has exited, while the output file may still be closing. */
	exited: boolean;
}

export class BackgroundShellManager {
	private readonly records = new Map<string, ShellRecord>();
	private readonly listeners = new Set<() => void>();
	private readonly foreground = new Set<() => boolean>();
	private settleWaiters: Array<() => void> = [];
	private readonly onSettled: ((shell: BackgroundShellInfo) => void) | undefined;
	private readonly maxOutputBytes: number;
	private disposed = false;

	constructor(options: BackgroundShellManagerOptions = {}) {
		this.onSettled = options.onSettled;
		this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	}

	/** Throws when no new command may start. Call before spawning one. */
	assertCanStart(): void {
		if (this.disposed) throw new Error("The session has ended; background commands cannot start.");
		if (this.runningCount() >= MAX_RUNNING_BACKGROUND_SHELLS) {
			throw new Error(
				`${MAX_RUNNING_BACKGROUND_SHELLS} background commands are already running. Stop some with task_stop before starting another.`,
			);
		}
	}

	/** Take ownership of a running process. Its output from now on goes through the returned `append`. */
	adopt(execution: BackgroundShellExecution): AdoptedBackgroundShell {
		const outputPath = execution.output.persist();
		const info: BackgroundShellInfo = {
			id: this.createId(),
			toolName: execution.toolName,
			command: execution.command,
			cwd: execution.cwd,
			status: "running",
			startedAt: Date.now(),
			timeoutSeconds: execution.timeoutSeconds,
			outputPath,
			outputBytes: execution.output.getTotalBytes(),
		};
		const record: ShellRecord = {
			info,
			output: execution.output,
			endedOutput: "",
			abort: execution.abort,
			settled: Promise.resolve(),
			exited: false,
		};
		record.settled = execution.done.then(
			({ exitCode }) =>
				this.finish(
					record,
					exitCode === null
						? { status: "failed", error: "terminated without an exit code" }
						: { status: exitCode === 0 ? "completed" : "failed", exitCode },
				),
			(error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				if (message === "aborted") return this.finish(record, { status: "stopped" });
				if (message.startsWith("timeout:")) return this.finish(record, { status: "timed_out" });
				return this.finish(record, { status: "failed", error: message });
			},
		);
		this.records.set(info.id, record);
		if (this.disposed) this.stop(info.id, "session");
		this.emitChange();
		return {
			id: info.id,
			outputPath,
			append: (data) => {
				if (!record.output) return;
				record.output.append(data);
				info.outputBytes = record.output.getTotalBytes();
				if (info.outputBytes > this.maxOutputBytes && info.status === "running" && !info.stoppedBy) {
					this.stop(info.id, "output_limit");
				}
			},
		};
	}

	/**
	 * Ask a running command to stop and return its snapshot, or undefined for an unknown ID.
	 * Stopping kills the process tree; `waitForExit` tells when the shell process has exited.
	 */
	stop(id: string, stopper: BackgroundShellStopper): BackgroundShellInfo | undefined {
		const record = this.records.get(id);
		if (!record) return undefined;
		// A process that already exited ended on its own; stopping it now would only hide how.
		if (record.info.status === "running" && !record.info.stoppedBy && !record.exited) {
			record.info.stoppedBy = stopper;
			record.abort.abort();
			this.emitChange();
		}
		return { ...record.info };
	}

	/** Resolve true once the command has exited, or false after `timeoutMs`. */
	async waitForExit(id: string, timeoutMs: number): Promise<boolean> {
		const record = this.records.get(id);
		if (!record) return true;
		let timer: NodeJS.Timeout | undefined;
		const timedOut = new Promise<false>((resolve) => {
			timer = setTimeout(() => resolve(false), timeoutMs);
		});
		try {
			return await Promise.race([record.settled.then(() => true as const), timedOut]);
		} finally {
			clearTimeout(timer);
		}
	}

	get(id: string): BackgroundShellInfo | undefined {
		const record = this.records.get(id);
		return record ? { ...record.info } : undefined;
	}

	/** All known commands, oldest first. */
	list(): BackgroundShellInfo[] {
		return [...this.records.values()].map((record) => ({ ...record.info }));
	}

	runningCount(): number {
		let count = 0;
		for (const record of this.records.values()) if (record.info.status === "running") count++;
		return count;
	}

	/** The output tail held in memory: the last 2000 lines or 50KB while running, 64KB once ended. */
	readOutput(id: string): string {
		const record = this.records.get(id);
		if (!record) return "";
		return record.output ? record.output.snapshot().content : record.endedOutput;
	}

	/** Called on every change to the commands; returns an unsubscribe function. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Resolves when any command ends. */
	waitForSettle(): Promise<void> {
		return new Promise((resolve) => this.settleWaiters.push(resolve));
	}

	/**
	 * Register a running foreground command that can move to the background. `promote` returns
	 * whether it moved. Returns the unregister function.
	 */
	registerForeground(promote: () => boolean): () => void {
		this.foreground.add(promote);
		this.emitChange();
		return () => {
			if (this.foreground.delete(promote)) this.emitChange();
		};
	}

	hasForeground(): boolean {
		return this.foreground.size > 0;
	}

	/** Move every running foreground command to the background. Returns how many moved. */
	promoteForeground(): number {
		let moved = 0;
		for (const promote of [...this.foreground]) {
			this.foreground.delete(promote);
			if (promote()) moved++;
		}
		if (moved > 0) this.emitChange();
		return moved;
	}

	/** Stop every running command without telling the model. Further adopted commands are stopped at once. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const id of this.records.keys()) this.stop(id, "session");
		this.foreground.clear();
	}

	private async finish(
		record: ShellRecord,
		result: { status: Exclude<BackgroundShellStatus, "running">; exitCode?: number; error?: string },
	): Promise<void> {
		record.exited = true;
		const info = record.info;
		const endedAt = Date.now();
		const output = record.output;
		// The end is published only once the output file is complete, so a reader told the command
		// ended reads all of its output.
		if (output) {
			output.finish();
			try {
				await output.closeTempFile();
			} catch (error) {
				info.outputFileError = error instanceof Error ? error.message : String(error);
			}
			info.outputBytes = output.getTotalBytes();
			record.endedOutput = truncateTail(output.snapshot().content, { maxBytes: ENDED_OUTPUT_TAIL_BYTES }).content;
			record.output = undefined;
		}
		// A stop request wins over the exit status it caused, except a process that exited on its own first.
		info.status = info.stoppedBy && result.status !== "completed" ? "stopped" : result.status;
		info.exitCode = result.exitCode;
		info.error = result.error;
		info.endedAt = endedAt;
		this.emitChange();
		// Report the end before waking waiters, so a waiter sees the notice the end produced.
		if (!this.disposed) {
			try {
				this.onSettled?.({ ...info });
			} catch {
				// Nothing awaits `settled`; a throwing callback must not become an unhandled rejection.
			}
		}
		const waiters = this.settleWaiters;
		this.settleWaiters = [];
		for (const resolve of waiters) resolve();
		this.pruneEnded();
	}

	/** Drop the commands that ended longest ago, after the latest end has been reported. */
	private pruneEnded(): void {
		const ended = [...this.records.values()]
			.filter((record) => record.info.status !== "running")
			.sort((a, b) => (a.info.endedAt ?? 0) - (b.info.endedAt ?? 0));
		for (const record of ended.slice(0, Math.max(0, ended.length - MAX_ENDED_BACKGROUND_SHELLS))) {
			this.records.delete(record.info.id);
		}
	}

	private createId(): string {
		let id: string;
		do id = randomBytes(4).toString("hex");
		while (this.records.has(id));
		return id;
	}

	private emitChange(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// A UI listener must not break process bookkeeping.
			}
		}
	}
}

/** The parts of a tool definition that background support changes. */
interface RebindableTool {
	parameters: unknown;
	description: string;
	execute: (...args: never[]) => unknown;
}

/**
 * Built-in tool definitions created without a manager (bash, powershell, task_stop), keyed by their
 * execute function so copies made with object spread are found too.
 */
const unboundTools = new WeakMap<
	object,
	{ parameters: unknown; description: string; rebuild: (manager: BackgroundShellManager) => RebindableTool }
>();

/** Record a definition created without a manager, so a session can rebuild it around its own. */
export function markUnboundTool(
	definition: RebindableTool,
	rebuild: (manager: BackgroundShellManager) => RebindableTool,
): void {
	unboundTools.set(definition.execute, {
		parameters: definition.parameters,
		description: definition.description,
		rebuild,
	});
}

/**
 * Give an extension's copy of a built-in shell tool the session's background commands. An extension
 * that re-registers `createBashToolDefinition(cwd)` to change its rendering keeps them; one that
 * replaced `execute` or the parameters may route commands elsewhere, so it is left foreground-only.
 */
export function bindBackgroundShells<T extends RebindableTool>(definition: T, manager: BackgroundShellManager): T {
	const unbound = unboundTools.get(definition.execute);
	if (!unbound || definition.parameters !== unbound.parameters) return definition;
	const rebuilt = unbound.rebuild(manager);
	return {
		...definition,
		parameters: rebuilt.parameters,
		// A description the extension wrote stays; the built-in one gains the background guidance.
		description: definition.description === unbound.description ? rebuilt.description : definition.description,
		execute: rebuilt.execute,
	};
}

/** Tool definitions created with a manager, keyed by their execute function like `unboundTools`. */
const boundTools = new WeakMap<object, BackgroundShellManager>();

/** Record that a definition starts its background commands in `manager`. */
export function markBoundTool(definition: { execute: object }, manager: BackgroundShellManager): void {
	boundTools.set(definition.execute, manager);
}

/** The manager a tool definition starts background commands in, if any. */
export function backgroundManagerOf(definition: { execute: object } | undefined): BackgroundShellManager | undefined {
	return definition ? boundTools.get(definition.execute) : undefined;
}

/** Whether a tool definition accepts `run_in_background`. */
export function offersBackgroundShells(definition: { parameters: unknown } | undefined): boolean {
	const properties = (definition?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
	return properties?.run_in_background !== undefined;
}

/** The model-facing summary of how a command ended, e.g. `Background command "npm test" failed with exit code 1`. */
export function describeBackgroundShellEnd(shell: BackgroundShellInfo): string {
	const command = `Background command "${formatCommandLabel(shell.command)}"`;
	switch (shell.status) {
		case "completed":
			return `${command} completed (exit code 0)`;
		case "failed":
			return shell.exitCode !== undefined
				? `${command} failed with exit code ${shell.exitCode}`
				: `${command} failed: ${shell.error ?? "unknown error"}`;
		case "timed_out":
			return `${command} was stopped at its ${shell.timeoutSeconds ?? "?"} second timeout`;
		case "stopped":
			switch (shell.stoppedBy) {
				case "user":
					return `${command} was stopped by the user`;
				case "output_limit":
					return `${command} was stopped because it wrote too much output (${formatSize(shell.outputBytes)})`;
				default:
					return `${command} was stopped`;
			}
		case "running":
			return `${command} is running`;
	}
}

/** A one-line command for labels: whitespace collapsed, at most `max` characters. */
export function formatCommandLabel(command: string, max = 120): string {
	const line = command.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const BACKGROUND_SHELL_MESSAGE_TYPE = "background_shell";

/** One ended command in a {@link BACKGROUND_SHELL_MESSAGE_TYPE} message. */
export interface BackgroundShellNotice {
	id: string;
	toolName: string;
	command: string;
	status: BackgroundShellStatus;
	exitCode?: number;
	summary: string;
	outputPath: string;
	/** The last lines of output, without terminal escapes. */
	outputTail: string;
	/** Why the output file is incomplete, when writing it failed. */
	outputFileError?: string;
}

export interface BackgroundShellMessageDetails {
	notices: BackgroundShellNotice[];
}

const NOTICE_TAIL_LINES = 20;
const NOTICE_TAIL_BYTES = 4 * 1024;

export function createBackgroundShellNotice(shell: BackgroundShellInfo, output: string): BackgroundShellNotice {
	const tail = truncateTail(sanitizeBinaryOutput(stripAnsi(output)).replace(/\r/g, ""), {
		maxLines: NOTICE_TAIL_LINES,
		maxBytes: NOTICE_TAIL_BYTES,
	});
	return {
		id: shell.id,
		toolName: shell.toolName,
		command: shell.command,
		status: shell.status,
		exitCode: shell.exitCode,
		summary: describeBackgroundShellEnd(shell),
		outputPath: shell.outputPath,
		outputTail: tail.content.trimEnd(),
		...(shell.outputFileError ? { outputFileError: shell.outputFileError } : {}),
	};
}

/** The text the model reads for ended commands. */
export function formatBackgroundShellNotices(notices: readonly BackgroundShellNotice[]): string {
	return notices
		.map((notice) =>
			[
				"<task-notification>",
				`<task-id>${notice.id}</task-id>`,
				`<status>${notice.status}</status>`,
				`<summary>${notice.summary}</summary>`,
				`<output-file>${notice.outputPath}</output-file>`,
				...(notice.outputFileError
					? [`<output-file-error>The output file is incomplete: ${notice.outputFileError}</output-file-error>`]
					: []),
				...(notice.outputTail ? ["<output-tail>", notice.outputTail, "</output-tail>"] : []),
				"</task-notification>",
			].join("\n"),
		)
		.join("\n\n");
}
