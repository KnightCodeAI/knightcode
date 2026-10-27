---
"@knightcodeai/cli": patch
---

Fixed Radius sign-in passing any URL the gateway returned to the system URL handler. The browser authorization endpoint and the device-code verification URL must now be `http:` or `https:` URLs, as GitHub Copilot, Kimi Code and Meta sign-in already required, so a `file:` path or a custom protocol in the response fails the login instead of being opened.
