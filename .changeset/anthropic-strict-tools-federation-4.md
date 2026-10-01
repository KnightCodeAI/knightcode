---
"@knightcodeai/cli": patch
---

Added a copy-code login method to Anthropic sign-in for machines where the browser runs elsewhere and the localhost callback cannot load. `/login` now asks for browser or copy-code login, and copy-code login asks you to paste the code Anthropic shows.
