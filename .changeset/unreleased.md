---
"@knightcodeai/cli": patch
---

Add AgentRouter as a built-in provider. `AGENTROUTER_API_KEY` enables five
AgentRouter models, defaulting to `agentrouter/glm-5.3`, with Claude routed through
the Anthropic Messages endpoint and the rest through the OpenAI-compatible one.
Token prices come from AgentRouter's rate table rather than upstream list prices;
cache costs remain estimates because AgentRouter does not publish its cache ratios.
