---
"@knightcodeai/cli": patch
---

Fixed Gemini web rejecting a saved sign-in after a restart or reinstall. Google rotates the session cookie while it is in use, and that new value is now saved.
