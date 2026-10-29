---
"@knightcodeai/cli": patch
---

Fixed an extension that sets the same active tools in a different order recording a "System Prompt Update: tools, rules" message, and on providers without mid-conversation system messages rewriting the prompt head and losing the cache. Tools that stay active now keep their order and newly active ones are appended.
