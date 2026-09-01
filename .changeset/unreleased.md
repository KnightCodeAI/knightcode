---
"@knightcodeai/cli": patch
---

Add AgentRouter as a built-in provider. `AGENTROUTER_API_KEY` now selects
`agentrouter/claude-opus-5` and the four other models AgentRouter publishes, with
Claude routed through the Anthropic Messages endpoint and the rest through the
OpenAI-compatible one. Prices come from AgentRouter's own rate table rather than
upstream list prices, so `/cost` reports what the gateway actually bills.
