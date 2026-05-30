import { z } from "zod";
import type { Tool as AITool } from "ai";
import {
  ALL_TOOLS,
  ALL_TOOL_NAMES,
  getAITools,
  getTool,
  type KnightcodeTool,
} from "./tools";

export const Mode = {
  BUILD: "BUILD",
  PLAN: "PLAN",
  AUTO: "AUTO",
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN, Mode.AUTO]);

export type ModeType = (typeof Mode)[keyof typeof Mode];

export type ToolName = (typeof ALL_TOOL_NAMES)[number];

export function getToolContracts(
  mode: ModeType,
  options: {
    include_deferred?: boolean;
    loaded_deferred?: ReadonlySet<string>;
  } = {},
): Record<string, AITool> {
  return getAITools(mode, options);
}

export type ToolContracts = ReturnType<typeof getToolContracts>;

export function getKnightcodeTool(name: string): KnightcodeTool | undefined {
  return getTool(name);
}

export const REGISTERED_TOOLS = ALL_TOOLS;
