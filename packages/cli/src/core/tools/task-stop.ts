import type { AgentTool } from "@knightcode/agent";
import { type Static, Type } from "typebox";
import {
	type BackgroundShellInfo,
	BackgroundShellManager,
	describeBackgroundShellEnd,
	formatCommandLabel,
	markUnboundTool,
} from "../background-shells.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { taskStopRenderers } from "./renderers/task-stop.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const taskStopSchema = Type.Object({
	task_id: Type.String({ description: "ID of the background command, from the result that started it" }),
});

export type TaskStopToolInput = Static<typeof taskStopSchema>;

export interface TaskStopToolDetails {
	taskId: string;
	command: string;
	/** The command's status after the stop: `running` when its process had not exited yet. */
	status: BackgroundShellInfo["status"];
	/** Whether the command had already ended before this call. */
	alreadyEnded: boolean;
}

export const taskStopToolSystemPromptContribution = {
	snippet: "Stop a background command",
	guidelines: [],
} as const;

/** How long a stop waits for the shell process to exit before reporting it as still stopping. */
const STOP_WAIT_MS = 5000;

export interface TaskStopToolOptions {
	/**
	 * Owner of the background commands this tool stops. Without it the tool stops nothing until a
	 * session registers it, which gives it the session's own (see bindBackgroundShells).
	 */
	backgroundShells?: BackgroundShellManager;
}

export function createTaskStopToolDefinition(
	options: TaskStopToolOptions = {},
): ToolDefinition<typeof taskStopSchema, TaskStopToolDetails | undefined> {
	const manager = options.backgroundShells ?? new BackgroundShellManager();
	const definition: ToolDefinition<typeof taskStopSchema, TaskStopToolDetails | undefined> = {
		name: "task_stop",
		label: "task_stop",
		description:
			"Stop a background command started with run_in_background, or moved to the background by the user, by the task ID its result gave. Kills its process tree; its output file stays readable.",
		promptSnippet: taskStopToolSystemPromptContribution.snippet,
		parameters: taskStopSchema,
		async execute(_toolCallId, { task_id }: TaskStopToolInput) {
			const id = task_id.trim();
			const shell = manager.get(id);
			if (!shell) {
				const running = manager.list().filter((candidate) => candidate.status === "running");
				const known = running.length
					? ` Running: ${running.map((candidate) => `${candidate.id} (${formatCommandLabel(candidate.command, 60)})`).join(", ")}.`
					: " No background commands are running.";
				throw new Error(`No background command has the ID "${id}".${known}`);
			}
			if (shell.status !== "running") {
				return {
					content: [{ type: "text", text: `${describeBackgroundShellEnd(shell)} before this stop; nothing to stop.` }],
					details: { taskId: id, command: shell.command, status: shell.status, alreadyEnded: true },
				};
			}
			manager.stop(id, "model");
			const exited = await manager.waitForExit(id, STOP_WAIT_MS);
			const label = formatCommandLabel(shell.command);
			const ended = manager.get(id);
			const status = ended?.status ?? "stopped";
			// The process had already exited when the stop came; it ended on its own.
			if (ended && ended.stoppedBy !== "model" && status !== "running") {
				return {
					content: [{ type: "text", text: `${describeBackgroundShellEnd(ended)} before this stop; nothing to stop.` }],
					details: { taskId: id, command: shell.command, status, alreadyEnded: true },
				};
			}
			return {
				content: [
					{
						type: "text",
						text: exited
							? `Stopped background command ${id} ("${label}").`
							: `Asked background command ${id} ("${label}") to stop; its process had not exited after ${STOP_WAIT_MS / 1000} seconds.`,
					},
				],
				details: { taskId: id, command: shell.command, status, alreadyEnded: false },
			};
		},
		...taskStopRenderers,
	};
	if (!options.backgroundShells) {
		markUnboundTool(definition, (backgroundShells) => createTaskStopToolDefinition({ backgroundShells }));
	}
	return definition;
}

export function createTaskStopTool(options?: TaskStopToolOptions): AgentTool<typeof taskStopSchema> {
	return wrapToolDefinition(createTaskStopToolDefinition(options));
}
