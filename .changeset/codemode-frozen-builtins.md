---
"@knightcodeai/cli": patch
---

Fixed a codemode script that patched built-ins (such as `Array.prototype.toJSON = ...`) crashing the host process and leaving the call unsettled. Built-ins are now frozen before the script runs, and malformed payloads from the sandbox worker fail the call as a `sandbox` error.
