import type { Tool as AITool } from "ai";
import {
  isToolAvailableInMode,
  type KnightcodeTool,
} from "./defineTool";
import type { ModeType } from "../schemas";

import { Read } from "./Read";
import { Write } from "./Write";
import { Edit } from "./Edit";
import { MultiEdit } from "./MultiEdit";
import { Bash } from "./Bash";
import { Glob } from "./Glob";
import { Grep } from "./Grep";
import { WebFetch } from "./WebFetch";
import { WebSearch } from "./WebSearch";
import { TodoWrite } from "./TodoWrite";
import { AskUserQuestion } from "./AskUserQuestion";
import { NotebookEdit } from "./NotebookEdit";
import { Skill } from "./Skill";
import { EnterPlanMode } from "./EnterPlanMode";
import { ExitPlanMode } from "./ExitPlanMode";
import { TaskCreate } from "./TaskCreate";
import { TaskList } from "./TaskList";
import { TaskGet } from "./TaskGet";
import { TaskUpdate } from "./TaskUpdate";
import { TaskStop } from "./TaskStop";
import { TaskOutput } from "./TaskOutput";
import { ToolSearch } from "./ToolSearch";
import { Agent } from "./Agent";
import { Config } from "./Config";
import { Memory } from "./Memory";

export {
  defineTool,
  isToolAvailableInMode,
  type KnightcodeTool,
  type ToolMetadata,
  type ToolVisibility,
} from "./defineTool";

export {
  Read,
  Write,
  Edit,
  MultiEdit,
  Bash,
  Glob,
  Grep,
  WebFetch,
  WebSearch,
  TodoWrite,
  AskUserQuestion,
  NotebookEdit,
  Skill,
  EnterPlanMode,
  ExitPlanMode,
  TaskCreate,
  TaskList,
  TaskGet,
  TaskUpdate,
  TaskStop,
  TaskOutput,
  ToolSearch,
  Agent,
  Config,
  Memory,
};

const ALL_TOOLS_LIST: KnightcodeTool[] = [
  Read,
  Write,
  Edit,
  MultiEdit,
  Bash,
  Glob,
  Grep,
  WebFetch,
  WebSearch,
  TodoWrite,
  AskUserQuestion,
  NotebookEdit,
  Skill,
  EnterPlanMode,
  ExitPlanMode,
  TaskCreate,
  TaskList,
  TaskGet,
  TaskUpdate,
  TaskStop,
  TaskOutput,
  ToolSearch,
  Agent,
  Config,
  Memory,
];

export const ALL_TOOLS: Readonly<Record<string, KnightcodeTool>> =
  Object.fromEntries(ALL_TOOLS_LIST.map((t) => [t.name, t]));

export const ALL_TOOL_NAMES = ALL_TOOLS_LIST.map((t) => t.name);

/**
 * The persistent multi-session Task suite. These are deferred by default but
 * can be pre-loaded for a turn (via getAITools' loaded_deferred) when the
 * workspace already has incomplete tasks, so the model can resume cross-session
 * work without a ToolSearch round-trip.
 */
export const TASK_SUITE_TOOL_NAMES = [
  "TaskCreate",
  "TaskList",
  "TaskGet",
  "TaskUpdate",
  "TaskStop",
  "TaskOutput",
] as const;

export function getTool(name: string): KnightcodeTool | undefined {
  return ALL_TOOLS[name];
}

export function getAITools(
  mode: ModeType,
  options: {
    include_deferred?: boolean;
    loaded_deferred?: ReadonlySet<string>;
  } = {},
): Record<string, AITool> {
  const includeDeferred = options.include_deferred ?? false;
  const loaded = options.loaded_deferred;
  const out: Record<string, AITool> = {};
  for (const tool of ALL_TOOLS_LIST) {
    if (!isToolAvailableInMode(tool, mode)) continue;
    if (tool.is_deferred && !includeDeferred && !loaded?.has(tool.name)) {
      continue;
    }
    out[tool.name] = tool.ai;
  }
  return out;
}

export function getDeferredTools(): KnightcodeTool[] {
  return ALL_TOOLS_LIST.filter((t) => t.is_deferred);
}

/**
 * Build an AI SDK tool-contract record for an explicit set of tool names,
 * bypassing mode/deferred filtering. The caller (e.g. a subagent) has already
 * decided which tools this context may use.
 */
export function getToolContractsByNames(
  names: string[],
): Record<string, AITool> {
  const out: Record<string, AITool> = {};
  for (const name of names) {
    const tool = ALL_TOOLS[name];
    if (tool) out[name] = tool.ai;
  }
  return out;
}

export function getDeferredToolNames(mode: ModeType): string[] {
  return ALL_TOOLS_LIST.filter(
    (t) => t.is_deferred && isToolAvailableInMode(t, mode),
  ).map((t) => t.name);
}

export type AllToolsRecord = Record<string, KnightcodeTool>;
