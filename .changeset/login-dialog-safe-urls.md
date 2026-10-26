---
"@knightcodeai/cli": patch
---

Fixed `/login` printing sign-in, device-code and help URLs as received. The dialog now opens only `http:` and `https:` URLs, shows web URLs normalized (control characters percent-encoded) and replaces control characters in anything else, so a URL cannot end its terminal hyperlink early or send its own escape sequences.
