import { WebFetch, type KnightcodeTool } from "@knightcode/shared";
import { apiClient } from "../../api-client";

export const tool: KnightcodeTool = WebFetch;

export async function execute(input: unknown): Promise<unknown> {
  const { url, prompt, max_length } = WebFetch.input_schema.parse(input);
  const res = await apiClient.web.fetch.$post({
    json: { url, maxLength: max_length },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Web fetch failed: ${text}`);
  }
  const result = (await res.json()) as Record<string, unknown>;
  result.prompt = prompt;
  return result;
}
