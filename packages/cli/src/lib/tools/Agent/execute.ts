import {
  Agent,
  ALL_TOOL_NAMES,
  getToolContractsByNames,
  type ModeType,
  type KnightcodeTool,
} from "@knightcode/shared";
import { generateText, type ModelMessage } from "ai";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveModel } from "../../inference/resolve-model";
import { resolveSubagentModel } from "../../inference/resolve-subagent-model";
import { loadAgents, getAgent, resolveAgentTools } from "../../agents/loader";
import { DEFAULT_AGENT_TYPE } from "../../agents/types";
import { runSubagentLoop, type SubagentStepResult } from "./run-subagent";
import { buildTaskNotification, enqueueNotification } from "./notifications";
import { executeLocalTool } from "../index";

export const tool: KnightcodeTool = Agent;

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
  modelOverride?: string;
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
  const resolvedModel = resolveSubagentModel({
    override: ctx.modelOverride,
    aliasArg: model,
    agentModel: agent.model,
  });
  const mode: ModeType = "BUILD";
  const maxTurns = agent.maxTurns ?? 25;

  const callStep = async (req: {
    system: string;
    messages: ModelMessage[];
    toolNames: string[];
    mode: ModeType;
    model: string;
  }): Promise<SubagentStepResult> => {
    const resolved = resolveModel(req.model, "medium");
    const tools = getToolContractsByNames(req.toolNames);
    const result = await generateText({
      model: resolved.model,
      system: req.system,
      messages: req.messages,
      tools,
      providerOptions: resolved.providerOptions,
    });
    return {
      text: result.text,
      toolCalls: result.toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
      finishReason: result.finishReason,
      usage: result.usage ?? null,
    };
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
