---
"@knightcodeai/cli": patch
---

Fixed streamed tool-call arguments being parsed and redrawn once per fragment. A call now renders once per frame, and the parser keeps only the text it still needs.
