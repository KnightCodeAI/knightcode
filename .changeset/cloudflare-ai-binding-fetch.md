---
"@knightcodeai/cli": patch
---

Changed the Cloudflare AI Gateway binding transport to pass requests straight to the Workers AI binding's `fetch` rather than translating them into universal-endpoint calls. `createGatewayBindingFetch` is replaced by `createAiBindingFetch(env.AI)`, which supports every method, non-JSON bodies and streaming request bodies instead of rejecting them.
