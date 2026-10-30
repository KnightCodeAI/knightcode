---
"@knightcodeai/cli": patch
---

Fixed codemode tool descriptions inlining a tool's whole output type when it was a union or spanned several lines, which added thousands of characters to every request. Unions of objects now list each variant's field names (with the value of `const` discriminators such as `action`), and other multi-line types point to `describeTool()` instead.
