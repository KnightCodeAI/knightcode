---
"@knightcodeai/cli": patch
---

Fixed codemode ignoring a `// @options:` line that is not the first line of the script, which ran the script without the requested `timeout_ms`; the call now fails with an error before the script runs.
