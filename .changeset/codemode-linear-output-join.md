---
"@knightcodeai/cli": patch
---

Fixed codemode blocking the process for seconds to minutes after scripts with many `text()` calls; joining the output items was quadratic.
