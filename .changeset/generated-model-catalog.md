---
"@knightcodeai/cli": patch
---

Changed the provider model catalog to be built when a release is built, from the published catalog sources, instead of shipping a snapshot committed to the repository. A release now carries the models and prices in effect at build time. AgentRouter is the first visible case: it no longer publishes `glm-5.3` or `gpt-5.6-sol`, and `gpt-6-astra` is available instead.
