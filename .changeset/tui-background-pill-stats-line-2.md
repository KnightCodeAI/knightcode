---
"@knightcodeai/cli": patch
---

Changed what a session records when it ends: the background commands it stops are written to the chat as stopped because the session ended, so resuming the session shows them, and a stopped command's notice now says who stopped it.
