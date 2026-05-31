import { z } from "zod";
import { defineTool } from "../defineTool";
import { MODEL_ALIAS_NAMES } from "../../models";

const input_schema = z.object({
  description: z.string().describe("A short (3-5 word) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z
    .string()
    .optional()
    .describe(
      "The type of specialized agent to use. If omitted, general-purpose is used.",
    ),
  model: z
    .enum(MODEL_ALIAS_NAMES)
    .optional()
    .describe(
      "Optional model override for this agent (one of the model aliases). If omitted, uses the agent's default or inherits from the parent.",
    ),
  run_in_background: z
    .boolean()
    .optional()
    .describe(
      "Set to true to run this agent in the background. You will be notified when it completes.",
    ),
});

export const Agent = defineTool({
  name: "Agent",
  is_read_only: false,
  is_concurrency_safe: false,
  is_deferred: true,
  visibility: "build_only",
  search_hint: "launch a specialized subagent to handle a multi-step task",
  input_schema,
  description: `Launch a new agent to handle complex, multi-step tasks autonomously.

Each agent type has specific capabilities and tools. Available agent types are listed in the system prompt.

When using the Agent tool, specify a subagent_type to use a specialized agent, or omit it to use the general-purpose agent.

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do.
- When the agent is done, it returns a single message. The result is not visible to the user — relay a concise summary yourself.
- You can run an agent in the background with run_in_background; you will be notified when it completes — do NOT poll.
- The agent's outputs should generally be trusted.
- Clearly tell the agent whether to write code or just research.
- To run agents in parallel, send a single message with multiple Agent tool calls.`,
});

export type AgentInput = z.infer<typeof input_schema>;
