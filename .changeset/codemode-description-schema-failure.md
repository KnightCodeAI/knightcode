---
"@knightcodeai/cli": patch
---

Fixed the codemode tool description to say that a tool whose declaration returns an object also resolves on failure when it returned that object, so scripts check its fields instead of expecting a rejection.
