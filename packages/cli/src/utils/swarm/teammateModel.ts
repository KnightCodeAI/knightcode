// Hardcoded fallback model for teammates when neither an explicit model nor a
// leader model is available. Mirrors the free-OpenRouter default the built-in
// agents use (see tools/AgentTool/built-in/*), so teammate spawning works out
// of the box for every user without requiring a configured model.
export function getHardcodedTeammateModelFallback(): string {
  return 'qwen/qwen3-coder:free'
}
