import {
  Agent,
  ALL_TOOL_NAMES,
  DEFAULT_CHAT_MODEL_ID,
  type ModeType,
  type KnightcodeTool,
} from "@knightcode/shared";
import type { ModelMessage } from "ai";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { apiClient } from "../../api-client";
import { loadAgents, getAgent, resolveAgentTools } from "../../agents/loader";
import { DEFAULT_AGENT_TYPE } from "../../agents/types";
import { runSubagentLoop, type SubagentStepResult } from "./run-subagent";
import { buildTaskNotification, enqueueNotification } from "./notifications";
import { executeLocalTool } from "../index";

export const tool: KnightcodeTool = Agent;

const MODEL_ALIAS: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
  haiku: "claude-haiku-4-5",
  gpt: "gpt-5.4",
  gpt_oss: "openai/gpt-oss-120b:free",
  gpt_mini: "gpt-5.4-mini",
  gpt_nano: "gpt-5.4-nano",
  cobuddy: "baidu/cobuddy:free",
  laguna_xs: "poolside/laguna-xs.2:free",
  laguna_m: "poolside/laguna-m.1:free",
  owl_alpha: "openrouter/owl-alpha",
  deepseek: "deepseek/deepseek-v4-flash:free",
  trinity_large: "arcee-ai/trinity-large-thinking:free",
  nemotron: "nvidia/nemotron-3-super-120b-a12b:free",
  glm: "z-ai/glm-5.1",
  glm_air: "z-ai/glm-4.5-air:free",
  kimi: "moonshotai/kimi-k2.6",
  xiaomi: "xiaomi/mimo-v2.5-pro",
  minimax: "minimax/minimax-m2.7",
};

/** Tools that require user confirmation outside AUTO mode (mirrors use-chat). */
function needsPermission(toolName: string, mode: ModeType): boolean {
  if (mode === "AUTO") return false;
  return ["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"].includes(
    toolName,
  );
}

type AgentCtx = {
  executionRoot: string;
  sessionId: string;
  requestToolPermission?: (toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }) => Promise<boolean>;
};

export async function execute(input: unknown, ctx: AgentCtx): Promise<unknown> {
  const { description, prompt, subagent_type, model, run_in_background } =
    Agent.input_schema.parse(input);

  const agents = loadAgents(ctx.executionRoot);
  const agentType = subagent_type ?? DEFAULT_AGENT_TYPE;
  const agent = getAgent(agents, agentType);
  if (!agent) {
    return {
      status: "error",
      error: `Unknown subagent_type "${agentType}". Available: ${agents
        .map((a) => a.agentType)
        .join(", ")}`,
    };
  }

  // Resolve the agent's tool set; never let a subagent spawn further agents.
  const toolNames = resolveAgentTools(agent, [...ALL_TOOL_NAMES]).filter(
    (n) => n !== "Agent",
  );
  const resolvedModel =
    (model && MODEL_ALIAS[model]) ||
    (agent.model && agent.model !== "inherit" && MODEL_ALIAS[agent.model]) ||
    DEFAULT_CHAT_MODEL_ID;
  const mode: ModeType = "BUILD";
  const maxTurns = agent.maxTurns ?? 25;

  const callStep = async (req: {
    system: string;
    messages: ModelMessage[];
    toolNames: string[];
    mode: ModeType;
    model: string;
  }): Promise<SubagentStepResult> => {
    const res = await apiClient["agent-step"].$post({ json: req as never });
    if (!res.ok) throw new Error(`agent-step failed: ${res.status}`);
    return (await res.json()) as SubagentStepResult;
  };

  const executeTool = (name: string, toolInput: unknown) =>
    executeLocalTool(name, toolInput, mode, ctx.sessionId, {
      cwd: ctx.executionRoot,
    });

  // Background: launch detached, return immediately, notify on completion.
  if (run_in_background) {
    const agentId = randomUUID();
    const dir = join(ctx.executionRoot, ".knightcode", "agent-output");
    mkdirSync(dir, { recursive: true });
    const outputFile = join(dir, `${agentId}.txt`);
    writeFileSync(outputFile, `Agent "${description}" running...\n`);

    void runSubagentLoop({
      system: agent.getSystemPrompt(),
      prompt,
      toolNames,
      mode,
      model: resolvedModel,
      maxTurns,
      cwd: ctx.executionRoot,
      callStep,
      executeTool,
      requestPermission: async () => false, // background: auto-deny prompts
      needsPermission: (name) => needsPermission(name, mode),
    })
      .then((r) => {
        writeFileSync(outputFile, r.text);
        enqueueNotification(
          agentId,
          buildTaskNotification({
            taskId: agentId,
            description,
            status: "completed",
            finalMessage: r.text,
            outputFile,
          }),
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        writeFileSync(outputFile, `Error: ${msg}`);
        enqueueNotification(
          agentId,
          buildTaskNotification({
            taskId: agentId,
            description,
            status: "failed",
            error: msg,
            outputFile,
          }),
        );
      });

    return {
      status: "async_launched",
      agentId,
      description,
      prompt,
      outputFile,
    };
  }

  // Foreground: bubble permission prompts to the live session if available.
  const requestPermission = async (toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }): Promise<boolean> =>
    ctx.requestToolPermission ? ctx.requestToolPermission(toolCall) : false;

  const result = await runSubagentLoop({
    system: agent.getSystemPrompt(),
    prompt,
    toolNames,
    mode,
    model: resolvedModel,
    maxTurns,
    cwd: ctx.executionRoot,
    callStep,
    executeTool,
    requestPermission,
    needsPermission: (name) => needsPermission(name, mode),
  });

  return { status: "completed", prompt: result.text, description };
}
