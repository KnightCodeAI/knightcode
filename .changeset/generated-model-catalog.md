---
"@knightcodeai/cli": patch
---

Changed the provider model catalog to be built when a release is built, from the published catalog sources, instead of shipping a snapshot committed to the repository. A release now carries the models and prices in effect at build time. AgentRouter is the exception, because its API refuses build machines: its catalog stays committed and is used as published. Its list changed too: `glm-5.3` and `gpt-5.6-sol` are gone and `gpt-6-astra` is available instead.
