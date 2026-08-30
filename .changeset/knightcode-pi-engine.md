---
"@knightcodeai/cli": minor
---

A rebuilt agent core.

The agent loop, session storage, provider layer and terminal UI were all
replaced. What that buys:

- **A measured ~1,100-token floor** for the system prompt and tool definitions —
  every request is smaller, on every model.
- **Real multi-provider support**: Anthropic, OpenAI/Codex, OpenRouter, Amazon
  Bedrock, xAI, Kimi, GitHub Copilot, and any custom endpoint through
  `models.json`. OAuth sign-in where the provider supports it, API keys
  everywhere else.
- **Sessions you can leave and come back to**: resume, fork, branch, search, and
  automatic compaction when a conversation outgrows the context window.
- **Extensions, skills and prompt templates**, discovered from the project or
  installed globally.
- **Headless mode**: `--print` with `text`, `json` or `rpc` output, for scripting
  and for driving KnightCode from another program.

Distribution is unchanged — a self-contained compiled binary per platform, no
Bun or Node needed at runtime.
