---
"@knightcodeai/cli": patch
---

Fixed codemode failing after an update or uninstall replaced the install a session was running from. The QuickJS runtime path is now resolved once, the bundled Node worker starts from an in-memory copy, and an error after the install changed on disk shows a hint to restart the session.
