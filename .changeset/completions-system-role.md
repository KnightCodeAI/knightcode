---
"@knightcodeai/cli": patch
---

Fixed Chat Completions requests to hosts other than OpenAI sending the developer role. Groq's Qwen template rejected that role on the first message. System messages now use the system role unless the endpoint is api.openai.com.
