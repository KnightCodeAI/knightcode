import { tool as aiTool, type Tool as AITool } from "ai";
import type { z } from "zod";
import type { ModeType } from "../schemas";

export type ToolVisibility = "always" | "build_only" | "plan_only";

export interface ToolMetadata<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  description: string;
  input_schema: I;
  output_schema?: O;
  is_read_only: boolean;
  is_concurrency_safe?: boolean;
  is_deferred?: boolean;
  visibility?: ToolVisibility;
  search_hint: string;
}

export interface KnightcodeTool<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  readonly name: string;
  readonly description: string;
  readonly input_schema: I;
  readonly output_schema?: O;
  readonly is_read_only: boolean;
  readonly is_concurrency_safe: boolean;
  readonly is_deferred: boolean;
  readonly visibility: ToolVisibility;
  readonly search_hint: string;
  readonly ai: AITool;
}

export function defineTool<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
>(meta: ToolMetadata<I, O>): KnightcodeTool<I, O> {
  return {
    name: meta.name,
    description: meta.description,
    input_schema: meta.input_schema,
    output_schema: meta.output_schema,
    is_read_only: meta.is_read_only,
    is_concurrency_safe: meta.is_concurrency_safe ?? false,
    is_deferred: meta.is_deferred ?? false,
    visibility: meta.visibility ?? "always",
    search_hint: meta.search_hint,
    ai: aiTool({
      description: meta.description,
      inputSchema: meta.input_schema,
    }),
  };
}

export function isToolAvailableInMode(
  tool: KnightcodeTool,
  mode: ModeType,
): boolean {
  if (tool.visibility === "always") return true;
  if (tool.visibility === "build_only") return mode !== "PLAN";
  if (tool.visibility === "plan_only") return mode === "PLAN";
  return true;
}
