---
"@knightcodeai/cli": patch
---

Fixed OpenCode and OpenCode Go sending every request to the shared inference base URL. Each model now uses its protocol's endpoint (`/openai/v1`, `/anthropic`, `/google/v1beta`, and `/systemone/v1` for Jev).
