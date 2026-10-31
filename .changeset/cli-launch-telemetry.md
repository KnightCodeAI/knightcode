---
"@knightcodeai/cli": patch
---

Install telemetry now also sends an anonymous ping each time the CLI or the desktop app starts, so daily, weekly, and monthly users can be counted for each. The ping carries a one-way hash of the local device ID, never the ID itself, and `enableInstallTelemetry: false` or `KNIGHTCODE_TELEMETRY=0` still turns every ping off.
