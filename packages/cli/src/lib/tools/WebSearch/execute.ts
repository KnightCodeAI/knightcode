import { WebSearch, type KnightcodeTool } from "@knightcode/shared";

export const tool: KnightcodeTool = WebSearch;

export async function execute(input: unknown): Promise<unknown> {
  // Validate inputs so the tool contract is unchanged, then degrade
  // gracefully: BYO-key WebSearch lands in the web-tools phase.
  const { allowed_domains, blocked_domains } =
    WebSearch.input_schema.parse(input);
  if (allowed_domains?.length && blocked_domains?.length) {
    throw new Error(
      "Cannot specify both allowed_domains and blocked_domains in the same request",
    );
  }
  return {
    error:
      "WebSearch is not configured. Add a search provider key in a future release; proceed without web search for now.",
    results: [],
  };
}
