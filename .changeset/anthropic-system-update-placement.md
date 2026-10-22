---
"@knightcodeai/cli": patch
---

Fixed Claude rejecting a request with a 400 when a system prompt update was followed by an assistant reply that sends no content, such as another model's empty or reasoning-only reply. The update now waits for the next assistant message that is actually sent.
