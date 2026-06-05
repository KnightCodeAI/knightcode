import {
  ALL_TOOL_NAMES,
  getTool,
  isToolAvailableInMode,
  type ModeType,
} from "@knightcode/shared";
import {
  runPreToolHooks,
  runPostToolHooks,
  runPostToolUseFailureHooks,
} from "../hooks";

import * as Read from "./Read/execute";
import * as Write from "./Write/execute";
import * as Edit from "./Edit/execute";
import * as MultiEdit from "./MultiEdit/execute";
import * as Bash from "./Bash/execute";
import * as Glob from "./Glob/execute";
import * as Grep from "./Grep/execute";
import * as WebFetch from "./WebFetch/execute";
import * as WebSearch from "./WebSearch/execute";
import * as TodoWrite from "./TodoWrite/execute";
import * as AskUserQuestion from "./AskUserQuestion/execute";
import * as NotebookEdit from "./NotebookEdit/execute";
import * as Skill from "./Skill/execute";
import * as EnterPlanMode from "./EnterPlanMode/execute";
import * as ExitPlanMode from "./ExitPlanMode/execute";
import * as TaskCreate from "./TaskCreate/execute";
import * as TaskList from "./TaskList/execute";
import * as TaskGet from "./TaskGet/execute";
import * as TaskUpdate from "./TaskUpdate/execute";
import * as TaskStop from "./TaskStop/execute";
import * as TaskOutput from "./TaskOutput/execute";
import * as ToolSearch from "./ToolSearch/execute";
import * as Agent from "./Agent/execute";
import * as Config from "./Config/execute";

export {
  getSessionModifiedFiles,
  undoSessionChanges,
} from "./shared/session-snapshot";

export { hasIncompleteTasksSync } from "./task-store";

type ToolExecutor = (
  input: unknown,
  ctx: {
    executionRoot: string;
    sessionId: string;
    requestToolPermission?: (toolCall: {
      toolCallId: string;
      toolName: string;
      input: unknown;
    }) => Promise<boolean>;
    modelOverride?: string;
  },
) => Promise<unknown>;

const EXECUTORS: Record<string, ToolExecutor> = {
  Read: Read.execute,
  Write: Write.execute,
  Edit: Edit.execute,
  MultiEdit: MultiEdit.execute,
  Bash: Bash.execute,
  Glob: Glob.execute,
  Grep: Grep.execute,
  WebFetch: WebFetch.execute,
  WebSearch: WebSearch.execute,
  TodoWrite: TodoWrite.execute,
  AskUserQuestion: AskUserQuestion.execute,
  NotebookEdit: NotebookEdit.execute,
  Skill: Skill.execute,
  EnterPlanMode: EnterPlanMode.execute,
  ExitPlanMode: ExitPlanMode.execute,
  TaskCreate: TaskCreate.execute,
  TaskList: TaskList.execute,
  TaskGet: TaskGet.execute,
  TaskUpdate: TaskUpdate.execute,
  TaskStop: TaskStop.execute,
  TaskOutput: TaskOutput.execute,
  ToolSearch: ToolSearch.execute,
  Agent: Agent.execute,
  Config: Config.execute,
};

/** Optional execution context — defaults preserve existing behavior. */
export type ExecuteLocalToolOptions = {
  /** Working directory for the tool (defaults to process.cwd()). */
  cwd?: string;
  /** Promise-based permission request (foreground subagent bubbling). */
  requestToolPermission?: (toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }) => Promise<boolean>;
  /** Per-spawn model override (raw OpenRouter id), consumed by the Agent tool. */
  modelOverride?: string;
};

async function executeLocalToolImpl(
  toolName: string,
  input: unknown,
  mode: ModeType,
  sessionId: string,
  options: ExecuteLocalToolOptions,
): Promise<unknown> {
  const tool = getTool(toolName);
  if (!tool) {
    throw new Error(
      `Unknown tool: ${toolName}. Available tools: ${ALL_TOOL_NAMES.join(", ")}`,
    );
  }
  if (!isToolAvailableInMode(tool, mode)) {
    throw new Error(`Tool ${toolName} is not available in ${mode} mode`);
  }
  const executor = EXECUTORS[toolName];
  if (!executor) {
    throw new Error(`Tool ${toolName} has no executor registered`);
  }
  return executor(input, {
    executionRoot: options.cwd ?? process.cwd(),
    sessionId,
    requestToolPermission: options.requestToolPermission,
    modelOverride: options.modelOverride,
  });
}

export async function executeLocalTool(
  toolName: string,
  input: unknown,
  mode: ModeType,
  sessionId?: string,
  options: ExecuteLocalToolOptions = {},
): Promise<unknown> {
  const sId = sessionId ?? "default";

  const preResult = await runPreToolHooks(toolName, input, sId);
  if (preResult.blocked) {
    throw new Error(
      preResult.reason
        ? `Hook blocked tool ${toolName}: ${preResult.reason}`
        : `Hook blocked tool ${toolName}`,
    );
  }

  let output: unknown;
  try {
    output = await executeLocalToolImpl(toolName, input, mode, sId, options);
  } catch (err) {
    void runPostToolUseFailureHooks(
      toolName,
      input,
      err instanceof Error ? err.message : String(err),
      sId,
    );
    throw err;
  }

  void runPostToolHooks(toolName, input, output, sId);
  return output;
}
