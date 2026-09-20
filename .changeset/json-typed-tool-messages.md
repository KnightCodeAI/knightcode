---
"@knightcodeai/cli": patch
---

Changed the transcript types so tool-call arguments and tool-result `details` are declared as JSON values instead of `any`. A tool that puts a `Date`, a function or `undefined` into `details` is now a type error rather than something that silently fails to round-trip through the session file.
