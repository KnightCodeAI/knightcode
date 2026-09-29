---
"@knightcodeai/cli": patch
---

Fixed OpenAI Responses streams running tool calls that never finished. A server that omits `output_index`, such as llama.cpp, could turn two parallel calls into three with cut-off or mixed-up arguments; the stream now fails instead of running them.
