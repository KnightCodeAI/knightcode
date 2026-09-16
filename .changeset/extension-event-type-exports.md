---
"@knightcodeai/cli": patch
---

Fixed the package's public types so extension authors can import the event and result types their hooks receive, such as `ModelSelectEvent`, `ThinkingLevelSelectEvent` and the `*Result` types, instead of redeclaring them.
