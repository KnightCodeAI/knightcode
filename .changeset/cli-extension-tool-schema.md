---
"@knightcodeai/cli": patch
---

Fixed extension tools registered without an object parameter schema being accepted, which broke provider request serialization later; registration now rejects them with an error naming the tool and the extension.
