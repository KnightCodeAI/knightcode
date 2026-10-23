---
"@knightcode/ai": minor
"@knightcodeai/cli": minor
---

Added a confirmation step to device-code sign-in. The dialog shows the code and waits for Enter before opening the browser and copying the code to the clipboard, so a code already on the clipboard is not replaced silently. Providers can turn either action off with `openBrowserOnConfirm` and `copyCodeOnConfirm` on the device-code event.
