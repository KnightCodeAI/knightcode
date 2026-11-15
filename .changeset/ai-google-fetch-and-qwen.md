---
"@knightcodeai/cli": patch
---

Fixed Gemini requests losing their idle timeout, and a continuation finish asking for more output, by always using the shared fetch and stopping that finish as a length limit.
