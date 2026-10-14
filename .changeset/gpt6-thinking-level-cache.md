---
"@knightcodeai/cli": patch
---

Changed OpenAI GPT-6 models to keep the prompt cache when the thinking level changes. A change now goes in as a configuration update instead of rewriting the reasoning effort, so earlier turns stay cached. Sign-in with ChatGPT and proxies keep the previous behavior.
